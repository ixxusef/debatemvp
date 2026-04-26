import { prisma } from "../lib/prisma.js";

type ClerkUserLike = {
  id: string;
  emailAddresses: { emailAddress: string }[];
};

export async function syncClerkUser(cu: ClerkUserLike) {
  const email = cu.emailAddresses[0]?.emailAddress ?? null;
  return prisma.user.upsert({
    where: { clerkId: cu.id },
    create: { clerkId: cu.id, email: email ?? undefined },
    update: { email: email ?? undefined },
  });
}

export async function getUserByClerkId(clerkId: string) {
  return prisma.user.findUnique({ where: { clerkId } });
}
