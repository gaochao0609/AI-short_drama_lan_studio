import { randomUUID } from "node:crypto";
import {
  type Prisma,
  ScriptSessionStatus,
  TaskType,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { streamProxyModel } from "@/lib/models/proxy-client";
import { getDefaultModelSummary } from "@/lib/models/provider-registry";
import { enqueueTask } from "@/lib/queues/enqueue";
import { getProject } from "@/lib/services/projects";
import { ServiceError } from "@/lib/services/errors";

type QaRecord = {
  round: number;
  question: string;
  answer: string;
};

type JsonQaCandidate = Record<string, Prisma.JsonValue>;

type OwnedScriptSession = {
  id: string;
  projectId: string;
  creatorId: string;
  idea: string;
  status: ScriptSessionStatus;
  completedRounds: number;
  currentQuestion: string | null;
  qaRecordsJson: Prisma.JsonValue | null;
};

type QuestionPromptSession = Pick<
  OwnedScriptSession,
  "id" | "projectId" | "idea" | "completedRounds" | "currentQuestion" | "qaRecordsJson"
>;

type QuestionGeneration = {
  sessionId: string;
  traceId: string;
  proxyStream: ReadableStream<Uint8Array>;
  persistGeneratedQuestion: (questionText: string) => Promise<void>;
  handleStreamingError?: () => Promise<void>;
};

function toQaJsonValue(records: QaRecord[]): Prisma.JsonValue {
  return records as unknown as Prisma.JsonValue;
}

function parseQaRecords(value: Prisma.JsonValue | null): QaRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const candidate = entry as JsonQaCandidate;

    const round =
      typeof candidate.round === "number" && Number.isInteger(candidate.round)
        ? candidate.round
        : null;
    const question =
      typeof candidate.question === "string" ? candidate.question : null;
    const answer =
      typeof candidate.answer === "string" ? candidate.answer : null;

    if (round === null || question === null || answer === null) {
      return [];
    }

    return [{ round, question, answer }];
  });
}

function upsertQaRecord(records: QaRecord[], nextRecord: QaRecord): QaRecord[] {
  const dedupedRecords = records.filter(
    (record) =>
      !(
        record.round === nextRecord.round &&
        record.question === nextRecord.question
      ),
  );

  return [...dedupedRecords, nextRecord];
}

async function getOwnedScriptSession(
  sessionId: string,
  userId: string,
): Promise<OwnedScriptSession> {
  const session = await prisma.scriptSession.findFirst({
    where: {
      id: sessionId,
      creatorId: userId,
    },
    select: {
      id: true,
      projectId: true,
      creatorId: true,
      idea: true,
      status: true,
      completedRounds: true,
      currentQuestion: true,
      qaRecordsJson: true,
    },
  });

  if (!session) {
    throw new ServiceError(404, "Script session not found");
  }

  return session;
}

async function requireWritableScriptSession(
  sessionId: string,
  userId: string,
) {
  const session = await getOwnedScriptSession(sessionId, userId);

  if (session.status === ScriptSessionStatus.FINALIZING) {
    throw new ServiceError(409, "Script session is finalizing");
  }

  if (session.status === ScriptSessionStatus.COMPLETED) {
    throw new ServiceError(409, "Script session is already completed");
  }

  if (session.status === ScriptSessionStatus.CANCELED) {
    throw new ServiceError(409, "Script session is canceled");
  }

  return session;
}

async function getQuestionModelSummary() {
  const summary = await getDefaultModelSummary("script_question_generate");

  if (!summary?.model) {
    throw new ServiceError(
      409,
      "Default model for script_question_generate is not configured",
    );
  }

  return {
    ...summary,
    model: summary.model,
  };
}

function buildQuestionPrompt(
  session: Pick<
    QuestionPromptSession,
    "idea" | "completedRounds" | "currentQuestion" | "qaRecordsJson"
  >,
  mode: "start" | "next" | "regenerate",
) {
  const qaRecords = parseQaRecords(session.qaRecordsJson);
  const lines = [
    "You are helping a user clarify a short-drama concept.",
    "Ask exactly one concise next question.",
    "Do not answer for the user.",
    `Session idea: ${session.idea}`,
  ];

  if (qaRecords.length > 0) {
    lines.push("Previous Q&A:");
    for (const record of qaRecords) {
      lines.push(
        `Round ${record.round} question: ${record.question}`,
        `Round ${record.round} answer: ${record.answer}`,
      );
    }
  }

  if (mode === "regenerate" && session.currentQuestion) {
    lines.push(
      `Replace the current question with a better alternative: ${session.currentQuestion}`,
    );
  } else if (mode === "next") {
    lines.push(
      `Completed rounds so far: ${session.completedRounds}. Ask the next clarification question.`,
    );
  } else {
    lines.push("Start the clarification session with the first question.");
  }

  return lines.join("\n");
}

async function prepareQuestionGeneration(
  session: QuestionPromptSession,
  mode: "start" | "next" | "regenerate",
  persistGeneratedQuestion: (questionText: string) => Promise<void>,
): Promise<QuestionGeneration> {
  const model = await getQuestionModelSummary();
  const traceId = randomUUID();

  const proxyStream = await streamProxyModel({
    taskType: "script_question_generate",
    providerKey: model.providerKey,
    model: model.model,
    traceId,
    inputFiles: [],
    inputText: buildQuestionPrompt(session, mode),
    options: {
      sessionId: session.id,
      projectId: session.projectId,
      mode,
    },
  });

  return {
    sessionId: session.id,
    traceId,
    proxyStream,
    persistGeneratedQuestion,
  };
}

async function deleteUnstartedScriptSession(sessionId: string, userId: string) {
  await prisma.scriptSession.deleteMany({
    where: {
      id: sessionId,
      creatorId: userId,
      status: ScriptSessionStatus.ACTIVE,
      completedRounds: 0,
      currentQuestion: null,
    },
  });
}

async function restorePendingQuestionAfterFailedAnswer(input: {
  sessionId: string;
  userId: string;
  completedRounds: number;
  previousCompletedRounds: number;
  previousQuestion: string;
  previousQaRecordsJson: Prisma.JsonValue | null;
}) {
  await prisma.scriptSession.updateMany({
    where: {
      id: input.sessionId,
      creatorId: input.userId,
      status: ScriptSessionStatus.ACTIVE,
      completedRounds: input.completedRounds,
      currentQuestion: null,
    },
    data: {
      completedRounds: input.previousCompletedRounds,
      currentQuestion: input.previousQuestion,
      qaRecordsJson:
        (input.previousQaRecordsJson ?? []) as Prisma.InputJsonValue,
    },
  });
}

export async function startScriptSession(
  projectId: string,
  idea: string,
  userId: string,
): Promise<QuestionGeneration> {
  await getProject(projectId, userId);

  const sessionId = randomUUID();
  await prisma.scriptSession.create({
    data: {
      id: sessionId,
      projectId,
      creatorId: userId,
      idea,
      currentQuestion: null,
      qaRecordsJson: [] as Prisma.InputJsonValue,
    },
  });

  try {
    const generation = await prepareQuestionGeneration(
      {
        id: sessionId,
        projectId,
        idea,
        completedRounds: 0,
        currentQuestion: null,
        qaRecordsJson: toQaJsonValue([]),
      },
      "start",
      async (questionText: string) => {
        const result = await prisma.scriptSession.updateMany({
          where: {
            id: sessionId,
            creatorId: userId,
            status: ScriptSessionStatus.ACTIVE,
            completedRounds: 0,
            currentQuestion: null,
          },
          data: {
            currentQuestion: questionText,
          },
        });

        if (result.count !== 1) {
          throw new ServiceError(
            409,
            "Script session changed before the first question could be saved",
          );
        }
      },
    );

    return {
      ...generation,
      handleStreamingError: async () => {
        await deleteUnstartedScriptSession(sessionId, userId);
      },
    };
  } catch (error) {
    await deleteUnstartedScriptSession(sessionId, userId);
    throw error;
  }
}

export async function answerScriptQuestion(
  sessionId: string,
  answer: string,
  userId: string,
): Promise<QuestionGeneration> {
  const session = await requireWritableScriptSession(sessionId, userId);

  if (!session.currentQuestion) {
    throw new ServiceError(409, "Script session does not have a pending question");
  }

  const updatedQaRecords = upsertQaRecord(parseQaRecords(session.qaRecordsJson), {
    round: session.completedRounds + 1,
    question: session.currentQuestion,
    answer,
  });
  const updatedCompletedRounds = session.completedRounds + 1;
  const previousQuestion = session.currentQuestion;

  const stageAnswerResult = await prisma.scriptSession.updateMany({
    where: {
      id: session.id,
      creatorId: userId,
      status: ScriptSessionStatus.ACTIVE,
      completedRounds: session.completedRounds,
      currentQuestion: session.currentQuestion,
    },
    data: {
      completedRounds: updatedCompletedRounds,
      qaRecordsJson: updatedQaRecords as Prisma.InputJsonValue,
      currentQuestion: null,
    },
  });

  if (stageAnswerResult.count !== 1) {
    throw new ServiceError(
      409,
      "Script session changed before the submitted answer could be staged",
    );
  }

  const restorePendingQuestion = async () => {
    await restorePendingQuestionAfterFailedAnswer({
      sessionId: session.id,
      userId,
      completedRounds: updatedCompletedRounds,
      previousCompletedRounds: session.completedRounds,
      previousQuestion,
      previousQaRecordsJson: session.qaRecordsJson,
    });
  };

  try {
    const generation = await prepareQuestionGeneration(
      {
        ...session,
        completedRounds: updatedCompletedRounds,
        currentQuestion: null,
        qaRecordsJson: toQaJsonValue(updatedQaRecords),
      },
      "next",
      async (questionText: string) => {
        const result = await prisma.scriptSession.updateMany({
          where: {
            id: session.id,
            creatorId: userId,
            status: ScriptSessionStatus.ACTIVE,
            completedRounds: updatedCompletedRounds,
            currentQuestion: null,
          },
          data: {
            currentQuestion: questionText,
          },
        });

        if (result.count !== 1) {
          throw new ServiceError(
            409,
            "Script session changed before the next question could be saved",
          );
        }
      },
    );

    return {
      ...generation,
      handleStreamingError: restorePendingQuestion,
    };
  } catch (error) {
    await restorePendingQuestion();
    throw error;
  }
}

export async function regenerateCurrentQuestion(
  sessionId: string,
  userId: string,
): Promise<QuestionGeneration> {
  const session = await requireWritableScriptSession(sessionId, userId);

  if (!session.currentQuestion) {
    throw new ServiceError(409, "Script session does not have a current question");
  }

  return prepareQuestionGeneration(
    session,
    "regenerate",
    async (questionText: string) => {
      const result = await prisma.scriptSession.updateMany({
        where: {
          id: session.id,
          creatorId: userId,
          status: ScriptSessionStatus.ACTIVE,
          completedRounds: session.completedRounds,
          currentQuestion: session.currentQuestion,
        },
        data: {
          currentQuestion: questionText,
        },
      });

      if (result.count !== 1) {
        throw new ServiceError(
          409,
          "Script session changed before the regenerated question could be saved",
        );
      }
    },
  );
}

export async function finalizeScriptSession(
  sessionId: string,
  userId: string,
): Promise<{ taskId: string }> {
  const session = await getOwnedScriptSession(sessionId, userId);

  if (session.status === ScriptSessionStatus.FINALIZING) {
    throw new ServiceError(409, "Script finalize task is already in progress");
  }

  if (session.status === ScriptSessionStatus.COMPLETED) {
    throw new ServiceError(409, "Script session is already completed");
  }

  if (session.status === ScriptSessionStatus.CANCELED) {
    throw new ServiceError(409, "Script session is canceled");
  }

  const task = await prisma.$transaction(async (tx) => {
    const freezeResult = await tx.scriptSession.updateMany({
      where: {
        id: session.id,
        creatorId: userId,
        status: ScriptSessionStatus.ACTIVE,
      },
      data: {
        status: ScriptSessionStatus.FINALIZING,
      },
    });

    if (freezeResult.count !== 1) {
      const latestSession = await tx.scriptSession.findFirst({
        where: {
          id: session.id,
          creatorId: userId,
        },
        select: {
          status: true,
        },
      });

      if (latestSession?.status === ScriptSessionStatus.FINALIZING) {
        throw new ServiceError(409, "Script finalize task is already in progress");
      }

      if (latestSession?.status === ScriptSessionStatus.COMPLETED) {
        throw new ServiceError(409, "Script session is already completed");
      }

      if (latestSession?.status === ScriptSessionStatus.CANCELED) {
        throw new ServiceError(409, "Script session is canceled");
      }

      throw new ServiceError(409, "Script session changed before finalize could start");
    }

    return tx.task.create({
      data: {
        projectId: session.projectId,
        createdById: userId,
        type: TaskType.SCRIPT_FINALIZE,
        inputJson: {
          sessionId: session.id,
        } as Prisma.InputJsonValue,
      },
      select: {
        id: true,
      },
    });
  });

  const traceId = randomUUID();

  try {
    await enqueueTask(task.id, TaskType.SCRIPT_FINALIZE, {
      sessionId: session.id,
      traceId,
    });
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      await tx.task.deleteMany({
        where: {
          id: task.id,
          projectId: session.projectId,
          createdById: userId,
          type: TaskType.SCRIPT_FINALIZE,
        },
      });
      await tx.scriptSession.updateMany({
        where: {
          id: session.id,
          creatorId: userId,
          status: ScriptSessionStatus.FINALIZING,
        },
        data: {
          status: ScriptSessionStatus.ACTIVE,
        },
      });
    });

    throw error;
  }

  return {
    taskId: task.id,
  };
}
