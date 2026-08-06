import { PrismaClient } from "@prisma/client";

/*
  The one place a person's life may be written down (invariant 12). Nothing
  here is baked into application code; it is data the user owns and can change.

  WP1 seeds only the single user row so auth has a home. Shifts, categories and
  the onboarding question belong to later packages.
*/

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();
  if (!email) {
    throw new Error("Set ALLOWED_EMAIL before seeding — it is the one account.");
  }

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      // Sensible starting values the user can change. Nullable in the schema;
      // filled here rather than defaulted in code.
      timezone: "UTC",
      planningHour: 18,
      wakingStart: "07:00",
      wakingEnd: "23:00",
      settings: {
        defaultReminder: { enabled: false, offsetMinutes: 15 },
        snoozeIntervalMinutes: 15,
        defaultEstimate: { enabled: true },
        boardWrap: false,
        rowClick: "inline",
        staleMechanism: true,
      },
    },
  });

  console.log(`Seeded user ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
