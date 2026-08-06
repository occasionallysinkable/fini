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
    // These three are configuration, so re-seeding corrects an existing row —
    // the timezone was wrong (UTC), and waking hours now default to the whole
    // day per R29. Settings JSON is left alone here so a re-seed never clobbers
    // a preference the user has changed.
    update: {
      timezone: "Asia/Karachi",
      wakingStart: "00:00",
      wakingEnd: "00:00",
    },
    create: {
      email,
      // Sensible starting values the user can change. Nullable in the schema;
      // filled here rather than defaulted in code.
      timezone: "Asia/Karachi", // Pakistan, UTC+5, no DST.
      planningHour: 18,
      // R29: waking hours default to 00:00–00:00, the whole day. Equal start and
      // end means the full day: no reminder is ever held, and R15 stays silent
      // until real shifts exist. The user narrows this window in Settings.
      wakingStart: "00:00",
      wakingEnd: "00:00",
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
