import LoginForm from "./login-form";

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string | string[];
  }>;
};

function sanitizeNextPath(nextPath?: string | string[]) {
  if (typeof nextPath !== "string" || !nextPath.startsWith("/")) {
    return undefined;
  }

  try {
    const sanitizedUrl = new URL(nextPath, "http://localhost");

    if (sanitizedUrl.origin !== "http://localhost") {
      return undefined;
    }

    return `${sanitizedUrl.pathname}${sanitizedUrl.search}${sanitizedUrl.hash}`;
  } catch {
    return undefined;
  }
}

export default async function LoginPage({ searchParams }: Readonly<LoginPageProps>) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const nextPath = sanitizeNextPath(resolvedSearchParams?.next);

  return <LoginForm nextPath={nextPath} />;
}
