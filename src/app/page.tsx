import { redirect } from "next/navigation";
import { AuthGuardError, requireUser } from "@/lib/auth/guards";

export default async function HomePage() {
  try {
    const user = await requireUser();

    if (user.forcePasswordChange) {
      redirect("/force-password");
    }

    if (user.role === "ADMIN") {
      redirect("/admin/users");
    }
  } catch (error) {
    if (error instanceof AuthGuardError && error.status === 401) {
      redirect("/login");
    }

    throw error;
  }

  redirect("/workspace");
}
