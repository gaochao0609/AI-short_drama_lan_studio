import LoginForm from "./login-form";

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: Readonly<LoginPageProps>) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const nextPath =
    typeof resolvedSearchParams?.next === "string" ? resolvedSearchParams.next : undefined;

  return <LoginForm nextPath={nextPath} />;
}
