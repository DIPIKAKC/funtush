import { prisma } from "../packages/database/prisma";

export async function submitBug(
  agencyId: string,
  data: {
    title: string;
    description: string;
    stepsToReproduce?: string;
    screenshotUrl?: string;
  }
) {
  if (!data.title?.trim()) throw new Error("title is required");
  if (!data.description?.trim()) throw new Error("description is required");

  return prisma.bugReport.create({
    data: {
      agencyId,
      title: data.title.trim(),
      description: data.description.trim(),
      stepsToReproduce: data.stepsToReproduce?.trim(),
      screenshotUrl: data.screenshotUrl,
      status: "REPORTED",
    },
  });
}

export async function getAgencyBugs(
  agencyId: string,
  status?: string,
  page = 1,
  limit = 20
) {
  const where = {
    agencyId,
    ...(status ? { status: status as any } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.bugReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.bugReport.count({ where }),
  ]);

  return { items, total, page, limit };
}