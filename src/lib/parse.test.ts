import { describe, it, expect } from "vitest";
import { parse, computeCaption, type ParseContext, type ShiftWindow } from "./parse";

/*
  WP2's correctness lives here. Every token in R16 has a case; every loosened
  spelling R27 makes mandatory has a case; R17's kind inference is checked with
  its cause; R15's caption is checked both ways. A silent parser bug costs a
  field the arithmetic needs, so this is the test that guards it.

  Today is fixed at 2026-08-07 (a Friday) so "today"/"tomorrow"/weekday maths
  is deterministic. The weekday is derived, not hand-counted.
*/

const TODAY = "2026-08-07";
const TODAY_WD = new Date(Date.UTC(2026, 7, 7)).getUTCDay(); // 5 = Friday

function ctx(over: Partial<ParseContext> = {}): ParseContext {
  return {
    today: TODAY,
    todayWeekday: TODAY_WD,
    knownProjects: [],
    knownPersons: [],
    defaultEstimateEnabled: true,
    shifts: [],
    ...over,
  };
}

// Convenience: find an echo line's text by field name.
function echo(r: ReturnType<typeof parse>, field: string): string | undefined {
  return r.echo.find((l) => l.field === field)?.text;
}

describe("R16 · every canonical token parses", () => {
  it("#work sets the project", () => {
    const r = parse("Pay invoices #work", ctx());
    expect(r.project).toEqual({ path: ["work"], isNew: true });
    expect(r.title).toBe("Pay invoices");
    expect(echo(r, "Project")).toBe("work (new)");
  });

  it("#work/payroll sets a sub-project", () => {
    const r = parse("Run it #work/payroll", ctx());
    expect(r.project).toEqual({ path: ["work", "payroll"], isNew: true });
    expect(echo(r, "Sub-project")).toBe("work / payroll (new)");
  });

  it("a known project is not marked new", () => {
    const r = parse("Ship it #work", ctx({ knownProjects: ["work"] }));
    expect(r.project?.isNew).toBe(false);
  });

  it("@sam adds a person with no role yet", () => {
    const r = parse("Ask @sam", ctx());
    expect(r.people).toHaveLength(1);
    expect(r.people[0]).toMatchObject({ name: "sam", role: null, isNew: true });
  });

  it("@sam:waiting sets the waiting-on role", () => {
    const r = parse("Review @sam:waiting", ctx());
    expect(r.people[0].role).toBe("waiting_on");
  });

  it("~45m and ~2h are estimates", () => {
    expect(parse("A ~45m", ctx()).estimateMinutes).toBe(45);
    expect(parse("A ~2h", ctx()).estimateMinutes).toBe(120);
  });

  it("a bare date is a do date", () => {
    const r = parse("Water plants Thursday", ctx());
    expect(r.doDate).toBe("2026-08-13"); // next Thursday
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe("Water plants");
  });

  it("tomorrow is a do date", () => {
    expect(parse("Call mum tomorrow", ctx()).doDate).toBe("2026-08-08");
  });

  it("by Thursday sets a due date and names the word", () => {
    const r = parse("File taxes by Thursday", ctx());
    expect(r.dueDate).toBe("2026-08-13");
    expect(r.dueKeyword).toBe("by");
    expect(echo(r, "Due")).toContain("“by”");
  });

  it("due 3 Sep 17:00 sets due date and time", () => {
    const r = parse("Send it due 3 Sep 17:00", ctx());
    expect(r.dueDate).toBe("2026-09-03");
    expect(r.dueTime).toBe("17:00");
  });

  it("9am is a due time today", () => {
    const r = parse("Standup 9am", ctx());
    expect(r.dueTime).toBe("09:00");
    expect(r.dueDate).toBe(TODAY);
  });

  it("at 15:30 is a due time", () => {
    expect(parse("Call at 15:30", ctx()).dueTime).toBe("15:30");
  });

  it("+15m, +1d and +at are reminders", () => {
    const r = parse("Meds by Thursday 10am +1d +15m +at", ctx());
    const offsets = r.reminders.map((x) => x.offsetMinutes);
    expect(offsets).toContain(1440);
    expect(offsets).toContain(15);
    expect(offsets).toContain(0);
  });

  it("every 1st is fixed recurrence, every!7d is after-completion", () => {
    expect(parse("Pay rent every 1st", ctx()).recurrence?.mode).toBe("fixed");
    const r = parse("Water plants every!7d", ctx());
    expect(r.recurrence?.mode).toBe("after_completion");
  });

  it("/split 20m and /nosplit set chunking", () => {
    expect(parse("Report /split 20m", ctx()).chunking).toEqual({
      splittable: true,
      minChunkMinutes: 20,
    });
    expect(parse("Dentist /nosplit", ctx()).chunking).toEqual({
      splittable: false,
      minChunkMinutes: null,
    });
  });

  it("^1 Oct is a defer date", () => {
    expect(parse("Book jab ^1 Oct", ctx()).deferUntil).toBe("2026-10-01");
  });

  it("*commitment overrides the inferred kind", () => {
    const r = parse("Do the thing *commitment", ctx());
    expect(r.kind).toBe("commitment");
    expect(r.kindExplicit).toBe(true);
  });

  it("// starts the reason and carries the rest of the line", () => {
    const r = parse("Send figures // they need it for the audit", ctx());
    expect(r.reason).toBe("they need it for the audit");
    expect(r.title).toBe("Send figures");
  });
});

describe("R27 · the loosened spellings are mandatory", () => {
  it("accepts every estimate spelling, with ! or ~ or none", () => {
    expect(parse("A !35mins", ctx()).estimateMinutes).toBe(35);
    expect(parse("A ~35 minutes", ctx()).estimateMinutes).toBe(35);
    expect(parse("A for 2 hours", ctx()).estimateMinutes).toBe(120);
    expect(parse("A 30 mins", ctx()).estimateMinutes).toBe(30);
    expect(parse("A 1.5h", ctx()).estimateMinutes).toBe(90);
  });

  it("accepts four due-date prepositions and names which one", () => {
    expect(parse("X before 8pm", ctx()).dueTime).toBe("20:00");
    expect(parse("X before 8pm", ctx()).dueKeyword).toBe("before");
    expect(parse("X no later than Sep 12", ctx()).dueDate).toBe("2026-09-12");
    expect(parse("X no later than Sep 12", ctx()).dueKeyword).toBe("no later than");
    expect(parse("X by Friday", ctx()).dueKeyword).toBe("by");
  });

  it("reads dates in either order and with or without the ordinal", () => {
    expect(parse("X 8pm today", ctx()).dueTime).toBe("20:00");
    expect(parse("X Sep 12", ctx()).doDate).toBe("2026-09-12");
    expect(parse("X 12 Sept", ctx()).doDate).toBe("2026-09-12");
    expect(parse("X 3rd of September", ctx()).doDate).toBe("2026-09-03");
  });

  it("binds a bare role word to the person", () => {
    const r = parse("Review @shannon asked", ctx());
    expect(r.people[0].role).toBe("asked_by");
    expect(r.people[0].roleInferred).toBe(true);
  });

  it("does not strip a role word when no person needs one", () => {
    const r = parse("I am waiting for the bus", ctx());
    expect(r.title).toBe("I am waiting for the bus");
  });

  it("an hour with no date is a due time today", () => {
    const r = parse("Lunch 1pm", ctx());
    expect(r.dueTime).toBe("13:00");
    expect(r.dueDate).toBe(TODAY);
  });

  it("a weekday that names today means today, echoed with (today)", () => {
    const r = parse("Gym Friday", ctx()); // today is Friday
    expect(r.doDate).toBe(TODAY);
    expect(r.doDateIsToday).toBe(true);
    expect(echo(r, "Do date")).toContain("(today)");
  });

  it("announces an empty estimate when the default is on", () => {
    const r = parse("Some task", ctx({ defaultEstimateEnabled: true }));
    expect(r.estimateGiven).toBe(false);
    expect(echo(r, "Estimate")).toContain("none given");
  });

  it("parses the real typed line from R27 end to end", () => {
    const r = parse(
      "Send updated email to MI before 8pm today asked !35mins @shannon",
      ctx()
    );
    expect(r.title).toBe("Send updated email to MI");
    expect(r.dueTime).toBe("20:00");
    expect(r.dueDate).toBe(TODAY);
    expect(r.estimateMinutes).toBe(35);
    expect(r.people[0]).toMatchObject({ name: "shannon", role: "asked_by" });
    expect(r.kind).toBe("commitment");
  });
});

describe("R17 · kind is inferred and the cause is printed", () => {
  it("asked-by makes it a commitment, naming the person", () => {
    const r = parse("Send figures @sam:asked", ctx());
    expect(r.kind).toBe("commitment");
    expect(r.kindCause).toBe("because sam asked");
    expect(echo(r, "Kind")).toContain("commitment");
  });

  it("delegated-to makes it a commitment", () => {
    expect(parse("Fix bug @dev:deleg", ctx()).kind).toBe("commitment");
  });

  it("a recurrence with nobody attached is a habit", () => {
    const r = parse("Stretch every day", ctx());
    expect(r.kind).toBe("habit");
    expect(r.kindCause).toContain("repeats");
  });

  it("everything else is unassigned", () => {
    const r = parse("Read a book", ctx());
    expect(r.kind).toBe("unassigned");
  });

  it("an explicit *own overrides the inference", () => {
    const r = parse("Errand @sam:asked *own", ctx());
    expect(r.kind).toBe("own");
    expect(r.kindExplicit).toBe(true);
  });
});

describe("R15 · one caption when a due time is outside every shift", () => {
  const day: ShiftWindow = {
    name: "Day",
    startMinutes: 9 * 60,
    endMinutes: 17 * 60,
    weekdays: [true, true, true, true, true, true, true],
  };

  it("prints the caption when the time falls outside the shift", () => {
    const c = computeCaption("2026-08-13", "20:00", ctx({ shifts: [day] }));
    expect(c).toBe("20:00 is outside your shifts on Thursday");
  });

  it("is silent when the time is inside a shift", () => {
    expect(computeCaption("2026-08-13", "10:00", ctx({ shifts: [day] }))).toBeNull();
  });

  it("is silent when there is no due time", () => {
    expect(computeCaption("2026-08-13", null, ctx({ shifts: [day] }))).toBeNull();
  });

  it("is silent when there are no shifts to check against", () => {
    expect(computeCaption("2026-08-13", "20:00", ctx({ shifts: [] }))).toBeNull();
  });

  it("surfaces through parse() on a full capture line", () => {
    const r = parse("Call the bank at 8am", ctx({ shifts: [day] }));
    expect(r.caption).toBe("08:00 is outside your shifts on Friday");
  });
});

describe("invariant 13 · nothing understood is discarded, nothing else is kept", () => {
  it("keeps unparsed words in the title and pulls every token out", () => {
    const r = parse(
      "Draft the Q3 report #work ~90m by Monday 5pm @priya:waiting // board wants it",
      ctx()
    );
    expect(r.title).toBe("Draft the Q3 report");
    expect(r.project?.path).toEqual(["work"]);
    expect(r.estimateMinutes).toBe(90);
    expect(r.dueDate).toBe("2026-08-10"); // next Monday
    expect(r.dueTime).toBe("17:00");
    expect(r.people[0]).toMatchObject({ name: "priya", role: "waiting_on" });
    expect(r.reason).toBe("board wants it");
  });

  it("drops an offset reminder that has no due date and warns", () => {
    const r = parse("Loose task +15m", ctx());
    expect(r.reminders).toHaveLength(0);
    expect(r.warnings.join(" ")).toContain("needs a due date");
  });
});
