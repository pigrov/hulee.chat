"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { loginLocalWebSession, logoutCurrentWebSession } from "./session";

export async function loginAction(formData: FormData): Promise<void> {
  const email = readRequiredFormString(formData, "email");
  const password = readRequiredFormString(formData, "password");
  let destination = "/login?error=invalid";

  try {
    const result = await loginLocalWebSession({
      email,
      password
    });
    destination = result.redirectPath;
  } catch {
    destination = "/login?error=invalid";
  }

  redirect(destination);
}

export async function logoutAction(): Promise<void> {
  await logoutCurrentWebSession();
  revalidatePath("/");
  revalidatePath("/admin/integrations");
  revalidatePath("/platform");
  redirect("/login");
}

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Form field ${name} is required.`);
  }

  return value;
}
