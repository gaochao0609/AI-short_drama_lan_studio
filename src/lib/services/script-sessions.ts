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
import { createTask } from "@/lib/services/tasks";

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
    OwnedScriptSession,
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
  sessionId: string,
  userId: string,
  mode: "start" | "next" | "regenerate",
) {
  const session = await requireWritableScriptSession(sessionId, userId);
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
    persistGeneratedQuestion: async (questionText: string) => {
      await prisma.scriptSession.update({
        where: {
          id: session.id,
        },
        data: {
          currentQuestion: questionText,
        },
      });
    },
  };
}

export async function startScriptSession(
  projectId: string,
  idea: string,
  userId: string,
): Promise<{ sessionId: string }> {
  await getProject(projectId, userId);

  const session = await prisma.scriptSession.create({
    data: {
      projectId,
      creatorId: userId,
      idea,
      qaRecordsJson: [] as Prisma.InputJsonValue,
    },
    select: {
      id: true,
    },
  });

  return {
    sessionId: session.id,
  };
}

export async function answerScriptQuestion(
  sessionId: string,
  answer: string,
  userId: string,
): Promise<{ nextQuestionText?: string; completed: boolean }> {
  const session = await requireWritableScriptSession(sessionId, userId);

  if (!session.currentQuestion) {
    throw new ServiceError(409, "Script session does not have a pending question");
  }

  const qaRecords = parseQaRecords(session.qaRecordsJson);
  qaRecords.push({
    round: session.completedRounds + 1,
    question: session.currentQuestion,
    answer,
  });

  await prisma.scriptSession.update({
    where: {
      id: session.id,
    },
    data: {
      completedRounds: session.completedRounds + 1,
      qaRecordsJson: qaRecords as Prisma.InputJsonValue,
      currentQuestion: null,
    },
  });

  return {
    completed: false,
  };
}

export async function regenerateCurrentQuestion(
  sessionId: string,
  userId: string,
): Promise<{ questionText: string }> {
  const session = await requireWritableScriptSession(sessionId, userId);

  if (!session.currentQuestion) {
    throw new ServiceError(409, "Script session does not have a current question");
  }

  return {
    questionText: session.currentQuestion,
  };
}

export async function finalizeScriptSession(
  sessionId: string,
  userId: string,
): Promise<{ taskId: string }> {
  const session = await requireWritableScriptSession(sessionId, userId);
  const traceId = randomUUID();
  const task = await createTask({
    projectId: session.projectId,
    createdById: userId,
    type: TaskType.SCRIPT_FINALIZE,
    inputJson: {
      sessionId: session.id,
    } as Prisma.InputJsonValue,
  });

  await enqueueTask(task.id, TaskType.SCRIPT_FINALIZE, {
    sessionId: session.id,
    traceId,
  });

  return {
    taskId: task.id,
  };
}

export async function generateScriptQuestion(
  input: {
    sessionId: string;
    userId: string;
    mode: "start" | "next" | "regenerate";
  },
) {
  return prepareQuestionGeneration(input.sessionId, input.userId, input.mode);
}
