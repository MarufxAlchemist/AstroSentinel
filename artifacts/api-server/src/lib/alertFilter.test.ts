/**
 * alertFilter.test.ts
 * -------------------
 * Admission of non-events, and the labelling that makes it safe.
 *
 * The operator asked to see the complete raw stream, including TEST packets
 * and triggers the flight software already ruled out. That is a legitimate
 * choice for auditing what an instrument emits. What is NOT acceptable is an
 * admitted non-event that looks like a real burst — someone could schedule
 * follow-up on a solar flare. So these tests assert BOTH halves: the item is
 * admitted when the flag is on, AND it carries a label that cannot be lost.
 */

import { afterEach, describe, expect, it } from "vitest";
import { applyAlertFilter } from "./alertFilter.js";

const FERMI_FIN = "gcn.classic.voevent.FERMI_GBM_FIN_POS";
const FERMI_GND = "gcn.classic.voevent.FERMI_GBM_GND_POS";
const SVOM_GRM = "gcn.notices.svom.voevent.grm";

const doc = (over: { role?: string; params?: Record<string, string> } = {}) => ({
  _voevent_doc: {
    role: over.role ?? "observation",
    params: {
      TrigID: "808341387", Data_Signif: "17.2",
      Def_NOT_a_GRB: "false", Test_Submission: "false",
      ...(over.params ?? {}),
    },
  },
});

afterEach(() => {
  delete process.env["GRB_ADMIT_TEST_TRIGGERS"];
  delete process.env["GRB_ADMIT_NON_ASTROPHYSICAL"];
});

describe("default posture: non-events are rejected", () => {
  it.each([
    ["role=test", doc({ role: "test" }), "test_trigger"],
    ["role=utility", doc({ role: "utility" }), "test_trigger"],
    ["Test_Submission", doc({ params: { Test_Submission: "true" } }), "test_trigger"],
    ["Def_NOT_a_GRB", doc({ params: { Def_NOT_a_GRB: "true" } }), "not_astrophysical"],
  ])("rejects %s", (_label, payload, category) => {
    const v = applyAlertFilter(FERMI_FIN, payload);
    expect(v.action).toBe("reject");
    if (v.action === "reject") expect(v.category).toBe(category);
  });

  it("still accepts a genuine observation", () => {
    expect(applyAlertFilter(FERMI_FIN, doc()).action).toBe("accept");
  });
});

describe("GRB_ADMIT_TEST_TRIGGERS", () => {
  it("admits a test packet when enabled", () => {
    process.env["GRB_ADMIT_TEST_TRIGGERS"] = "true";
    expect(applyAlertFilter(FERMI_FIN, doc({ role: "test" })).action).toBe("accept");
  });

  it("labels it TEST so it cannot pass for a detection", () => {
    process.env["GRB_ADMIT_TEST_TRIGGERS"] = "true";
    const v = applyAlertFilter(FERMI_FIN, doc({ params: { Test_Submission: "true" } }));
    expect(v.action === "accept" && v.alertType).toBe("TEST");
  });

  it("does not admit a non-astrophysical trigger — the flags are independent", () => {
    process.env["GRB_ADMIT_TEST_TRIGGERS"] = "true";
    expect(applyAlertFilter(FERMI_FIN, doc({ params: { Def_NOT_a_GRB: "true" } })).action)
      .toBe("reject");
  });
});

describe("GRB_ADMIT_NON_ASTROPHYSICAL", () => {
  it("admits a Def_NOT_a_GRB trigger when enabled", () => {
    process.env["GRB_ADMIT_NON_ASTROPHYSICAL"] = "true";
    expect(applyAlertFilter(FERMI_FIN, doc({ params: { Def_NOT_a_GRB: "true" } })).action)
      .toBe("accept");
  });

  it("labels it NOT-A-GRB", () => {
    process.env["GRB_ADMIT_NON_ASTROPHYSICAL"] = "true";
    const v = applyAlertFilter(FERMI_FIN, doc({ params: { Def_NOT_a_GRB: "true" } }));
    expect(v.action === "accept" && v.alertType).toBe("NOT-A-GRB");
  });
});

describe("the label survives every other code path", () => {
  it("is not overwritten by the lifecycle stage", () => {
    // GND_POS would otherwise set alertType="UPDATE" and erase the marker.
    process.env["GRB_ADMIT_NON_ASTROPHYSICAL"] = "true";
    const v = applyAlertFilter(FERMI_GND, doc({ params: { Def_NOT_a_GRB: "true" } }));
    expect(v.action === "accept" && v.alertType).toBe("NOT-A-GRB");
    expect(v.action === "accept" && v.lifecycle).toBe("update");
  });

  it("is not overwritten by the SVOM branch", () => {
    // The SVOM branch resets alertType to "PRELIMINARY"; it must skip a marker.
    process.env["GRB_ADMIT_TEST_TRIGGERS"] = "true";
    const v = applyAlertFilter(SVOM_GRM, doc({ role: "test" }));
    expect(v.action === "accept" && v.alertType).toBe("TEST");
  });

  it("prefers NOT-A-GRB over TEST — it is the stronger statement", () => {
    process.env["GRB_ADMIT_TEST_TRIGGERS"] = "true";
    process.env["GRB_ADMIT_NON_ASTROPHYSICAL"] = "true";
    const v = applyAlertFilter(FERMI_FIN, doc({
      role: "test", params: { Def_NOT_a_GRB: "true", Test_Submission: "true" },
    }));
    expect(v.action === "accept" && v.alertType).toBe("NOT-A-GRB");
  });

  it("never assigns a classification tier to a non-event", () => {
    process.env["GRB_ADMIT_NON_ASTROPHYSICAL"] = "true";
    const v = applyAlertFilter(FERMI_FIN, doc({ params: { Def_NOT_a_GRB: "true" } }));
    // A tier would render it as a graded detection.
    expect(v.action === "accept" && v.classificationTier).toBeNull();
  });

  it("leaves a genuine burst unlabelled", () => {
    process.env["GRB_ADMIT_TEST_TRIGGERS"] = "true";
    process.env["GRB_ADMIT_NON_ASTROPHYSICAL"] = "true";
    const v = applyAlertFilter(FERMI_FIN, doc());
    expect(v.action === "accept" && v.alertType).toBe("FINAL");
  });
});

describe("flag parsing", () => {
  it.each(["false", "FALSE", "0", "yes", "", "nonsense"])(
    "treats %s as disabled — only an explicit true opts in", (val) => {
      process.env["GRB_ADMIT_TEST_TRIGGERS"] = val;
      expect(applyAlertFilter(FERMI_FIN, doc({ role: "test" })).action).toBe("reject");
    },
  );

  it.each(["true", "TRUE", " true "])("treats %s as enabled", (val) => {
    process.env["GRB_ADMIT_TEST_TRIGGERS"] = val;
    expect(applyAlertFilter(FERMI_FIN, doc({ role: "test" })).action).toBe("accept");
  });
});
