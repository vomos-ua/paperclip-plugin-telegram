import { describe, it, expect } from "vitest";
import {
  formatIssueCreated,
  formatIssueDone,
  formatIssueAssigned,
  formatApprovalCreated,
  formatAgentError,
  formatAgentRunStarted,
  formatAgentRunFinished,
  getMessageLanguage,
  maskSecrets,
} from "../src/formatters.js";
import type { PluginEvent } from "@paperclipai/plugin-sdk";

function mockEvent(overrides: Record<string, unknown> = {}): PluginEvent {
  return {
    eventType: "issue.created",
    entityId: "iss-123",
    entityType: "issue",
    companyId: "co-1",
    occurredAt: new Date().toISOString(),
    payload: { identifier: "PROJ-42", title: "Test issue", ...overrides },
  } as PluginEvent;
}

describe("formatIssueCreated", () => {
  it("includes identifier and title", () => {
    const msg = formatIssueCreated(mockEvent());
    expect(msg.text).toContain("PROJ\\-42");
    expect(msg.text).toContain("Test issue");
  });

  it("falls back to entityId when no identifier", () => {
    const msg = formatIssueCreated(mockEvent({ identifier: undefined }));
    expect(msg.text).toContain("iss\\-123");
  });

  it("uses MarkdownV2 parse mode", () => {
    const msg = formatIssueCreated(mockEvent());
    expect(msg.options.parseMode).toBe("MarkdownV2");
  });

  it("includes metadata fields when available", () => {
    const msg = formatIssueCreated(mockEvent({
      status: "open",
      priority: "high",
      assigneeName: "Alice",
      projectName: "Backend",
    }));
    expect(msg.text).toContain("open");
    expect(msg.text).toContain("high");
    expect(msg.text).toContain("Alice");
    expect(msg.text).toContain("Backend");
  });

  it("includes description snippet", () => {
    const msg = formatIssueCreated(mockEvent({ description: "A long description about this issue" }));
    expect(msg.text).toContain("A long description");
  });

  it("truncates long descriptions at word boundary", () => {
    const words = Array(50).fill("word").join(" ");
    const msg = formatIssueCreated(mockEvent({ description: words }));
    expect(msg.text).toContain("\\.\\.\\.");
    expect(msg.text.length).toBeLessThan(words.length * 2);
  });

  it("omits metadata line when no metadata", () => {
    const msg = formatIssueCreated(mockEvent({
      status: undefined,
      priority: undefined,
      assigneeName: undefined,
      projectName: undefined,
    }));
    expect(msg.text).not.toContain("\\|");
  });
});

describe("formatIssueDone", () => {
  it("includes identifier and done text", () => {
    const msg = formatIssueDone(mockEvent());
    expect(msg.text).toContain("PROJ\\-42");
    expect(msg.text).toContain("done");
  });

  it("falls back to entityId", () => {
    const msg = formatIssueDone(mockEvent({ identifier: undefined }));
    expect(msg.text).toContain("iss\\-123");
  });

  it("includes comment when provided", () => {
    const msg = formatIssueDone(mockEvent({ comment: "Board prep package completed for Q3" }));
    expect(msg.text).toContain("Board prep package completed for Q3");
  });

  it("truncates long comments", () => {
    const longComment = Array(80).fill("word").join(" ");
    const msg = formatIssueDone(mockEvent({ comment: longComment }));
    expect(msg.text).toContain("\\.\\.\\.");
  });

  it("omits comment section when no comment", () => {
    const msg = formatIssueDone(mockEvent());
    // Should only have the title and done line, no blockquote
    const lines = msg.text.split("\n").filter((l: string) => l.trim());
    expect(lines.length).toBe(2);
  });
});

describe("formatIssueAssigned", () => {
  it("shows the assigned user when assigning from nobody", () => {
    const msg = formatIssueAssigned(mockEvent({
      assigneeUserId: "user-me",
      assigneeName: "Nuno",
      _previous: { assigneeUserId: null, assigneeName: null },
    }));
    expect(msg.text).toContain("Issue Assigned");
    expect(msg.text).toContain("PROJ\\-42");
    expect(msg.text).toContain("Nuno");
    // No previous-name line
    expect(msg.text).not.toContain("→");
  });

  it("shows 'previous → new' when reassigning from another user", () => {
    const msg = formatIssueAssigned(mockEvent({
      assigneeUserId: "user-me",
      assigneeName: "Nuno",
      _previous: { assigneeUserId: "user-other", assigneeName: "Alice" },
    }));
    expect(msg.text).toContain("Alice");
    expect(msg.text).toContain("Nuno");
    expect(msg.text).toContain("→");
  });

  it("shows 'Unassigned' when the new assignee is null", () => {
    const msg = formatIssueAssigned(mockEvent({
      assigneeUserId: null,
      assigneeName: null,
      _previous: { assigneeUserId: "user-me", assigneeName: "Nuno" },
    }));
    expect(msg.text).toContain("Unassigned");
  });

  it("uses MarkdownV2 parse mode", () => {
    const msg = formatIssueAssigned(mockEvent({ assigneeName: "Nuno" }));
    expect(msg.options.parseMode).toBe("MarkdownV2");
  });

  it("falls back to entityId when no identifier", () => {
    const msg = formatIssueAssigned(mockEvent({ identifier: undefined, assigneeName: "Nuno" }));
    expect(msg.text).toContain("iss\\-123");
  });
});

describe("formatApprovalCreated", () => {
  it("includes approve and reject buttons", () => {
    const msg = formatApprovalCreated(mockEvent({
      type: "deploy",
      approvalId: "apr-1",
      title: "Deploy to prod",
    }));
    expect(msg.options.inlineKeyboard).toBeDefined();
    const buttons = msg.options.inlineKeyboard![0];
    expect(buttons.length).toBe(2);
    expect(buttons[0].text).toBe("Approve");
    expect(buttons[0].callback_data).toBe("approve_apr-1");
    expect(buttons[1].text).toBe("Reject");
    expect(buttons[1].callback_data).toBe("reject_apr-1");
  });

  it("falls back to entityId for approvalId", () => {
    const msg = formatApprovalCreated(mockEvent({ approvalId: undefined }));
    const buttons = msg.options.inlineKeyboard![0];
    expect(buttons[0].callback_data).toBe("approve_iss-123");
  });

  it("includes agent name when provided", () => {
    const msg = formatApprovalCreated(mockEvent({
      agentName: "Builder",
      type: "deploy",
    }));
    expect(msg.text).toContain("Builder");
  });

  it("includes linked issues", () => {
    const msg = formatApprovalCreated(mockEvent({
      linkedIssues: [
        { identifier: "ISS-1", title: "First", status: "open" },
        { identifier: "ISS-2", title: "Second", status: "done" },
      ],
    }));
    expect(msg.text).toContain("ISS\\-1");
    expect(msg.text).toContain("ISS\\-2");
    expect(msg.text).toContain("Linked Issues");
  });

  it("truncates description at word boundary", () => {
    const longDesc = Array(80).fill("word").join(" ");
    const msg = formatApprovalCreated(mockEvent({ description: longDesc }));
    expect(msg.text).toContain("\\.\\.\\.");
  });
});

describe("formatAgentError", () => {
  it("includes agent name and error", () => {
    const msg = formatAgentError(mockEvent({
      agentName: "Builder",
      error: "Connection refused",
    }));
    expect(msg.text).toContain("Builder");
    expect(msg.text).toContain("Connection refused");
  });

  it("truncates long error messages", () => {
    const longError = "x".repeat(600);
    const msg = formatAgentError(mockEvent({ error: longError }));
    expect(msg.text).toContain("\\.\\.\\.");
    expect(msg.text).not.toContain("x".repeat(501));
  });

  it("falls back to entityId for agent name", () => {
    const msg = formatAgentError(mockEvent({ agentName: undefined, name: undefined }));
    expect(msg.text).toContain("iss\\-123");
  });
});

describe("formatAgentRunStarted", () => {
  it("includes agent name", () => {
    const msg = formatAgentRunStarted(mockEvent({ agentName: "Deployer" }));
    expect(msg.text).toContain("Deployer");
    expect(msg.text).toContain("started");
  });

  it("disables notification", () => {
    const msg = formatAgentRunStarted(mockEvent());
    expect(msg.options.disableNotification).toBe(true);
  });
});

describe("formatAgentRunFinished", () => {
  it("includes agent name and completion text", () => {
    const msg = formatAgentRunFinished(mockEvent({ agentName: "Deployer" }));
    expect(msg.text).toContain("Deployer");
    expect(msg.text).toContain("completed");
  });

  it("disables notification", () => {
    const msg = formatAgentRunFinished(mockEvent());
    expect(msg.options.disableNotification).toBe(true);
  });
});

describe("getMessageLanguage", () => {
  it("returns en for tech role: developer", () => {
    expect(getMessageLanguage("developer")).toBe("en");
  });

  it("returns en for tech role: cto", () => {
    expect(getMessageLanguage("cto")).toBe("en");
  });

  it("returns en for tech role: qa", () => {
    expect(getMessageLanguage("qa")).toBe("en");
  });

  it("returns en for tech role: devops", () => {
    expect(getMessageLanguage("devops")).toBe("en");
  });

  it("returns en for tech role: n8n-engineer", () => {
    expect(getMessageLanguage("n8n-engineer")).toBe("en");
  });

  it("returns en for tech role: security", () => {
    expect(getMessageLanguage("security")).toBe("en");
  });

  it("returns ua for business role: ceo", () => {
    expect(getMessageLanguage("ceo")).toBe("ua");
  });

  it("returns ua for business role: cmo", () => {
    expect(getMessageLanguage("cmo")).toBe("ua");
  });

  it("returns ua for business role: sales", () => {
    expect(getMessageLanguage("sales")).toBe("ua");
  });

  it("returns ua for business role: cho", () => {
    expect(getMessageLanguage("cho")).toBe("ua");
  });

  it("returns ua for business role: hr", () => {
    expect(getMessageLanguage("hr")).toBe("ua");
  });

  it("returns en for undefined (fallback)", () => {
    expect(getMessageLanguage(undefined)).toBe("en");
  });

  it("returns en for unknown role (fallback)", () => {
    expect(getMessageLanguage("unknown-role")).toBe("en");
  });
});

describe("maskSecrets", () => {
  it("masks sk- tokens", () => {
    expect(maskSecrets("Error with sk-abc123xyz456 token")).toBe("Error with [REDACTED] token");
  });

  it("masks ghp_ tokens", () => {
    expect(maskSecrets("Using ghp_AbCdEfGhIjKlMnOp token")).toBe("Using [REDACTED] token");
  });

  it("masks xoxb- tokens", () => {
    expect(maskSecrets("Slack xoxb-123-456-abc token failed")).toBe("Slack [REDACTED] token failed");
  });

  it("masks Bearer tokens", () => {
    expect(maskSecrets("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret")).toBe(
      "Authorization: [REDACTED]",
    );
  });

  it("masks password= patterns", () => {
    expect(maskSecrets("connect string password=mysecretpw host=db")).toBe(
      "connect string [REDACTED] host=db",
    );
  });

  it("returns text unchanged when no secrets", () => {
    expect(maskSecrets("This is a normal error message")).toBe("This is a normal error message");
  });

  it("truncates text longer than 200 chars", () => {
    const long = "x".repeat(250);
    const result = maskSecrets(long);
    expect(result.length).toBeLessThanOrEqual(203);
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("emoji category markers", () => {
  it("formatAgentError uses 🚨 error marker", () => {
    const msg = formatAgentError(mockEvent({ agentName: "Builder", error: "boom" }));
    expect(msg.text).toContain("🚨");
  });

  it("formatApprovalCreated uses ⚠️ approval marker", () => {
    const msg = formatApprovalCreated(mockEvent({ type: "deploy", approvalId: "apr-1" }));
    expect(msg.text).toContain("⚠️");
  });

  it("formatIssueCreated uses 📋 status marker", () => {
    const msg = formatIssueCreated(mockEvent());
    expect(msg.text).toContain("📋");
  });

  it("formatIssueDone uses 📋 status marker", () => {
    const msg = formatIssueDone(mockEvent());
    expect(msg.text).toContain("📋");
  });

  it("formatIssueAssigned uses 📋 status marker", () => {
    const msg = formatIssueAssigned(mockEvent({ assigneeName: "Nuno" }));
    expect(msg.text).toContain("📋");
  });
});

describe("maskSecrets applied in formatAgentError", () => {
  it("redacts sk- token in error field", () => {
    const msg = formatAgentError(mockEvent({ error: "API call failed: sk-realtoken123 invalid" }));
    expect(msg.text).not.toContain("sk-realtoken123");
    // MarkdownV2 escapes [ and ] — \[REDACTED\] is the correct form in the message text
    expect(msg.text).toContain("\\[REDACTED\\]");
  });

  it("truncates error longer than 200 chars", () => {
    const longError = "Connection failed: " + "x".repeat(250);
    const msg = formatAgentError(mockEvent({ error: longError }));
    expect(msg.text).not.toContain("x".repeat(201));
  });
});
