const LINEAR_API = "https://api.linear.app/graphql";
const ASSIGNEE_EMAIL = "chb@tacticalbusinesspartners.com";

const $ = (id) => document.getElementById(id);

const setStatus = (msg, type = "") => {
  const el = $("status");
  el.textContent = msg;
  el.className = type;
};

async function linearQuery(apiKey, query, variables = {}) {
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear API error: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

async function fetchTeams(apiKey) {
  const data = await linearQuery(apiKey, `
    query {
      teams {
        nodes { id name }
      }
    }
  `);
  return data.teams.nodes;
}

async function fetchAssigneeId(apiKey) {
  const data = await linearQuery(apiKey, `
    query($email: String!) {
      users(filter: { email: { eq: $email } }) {
        nodes { id }
      }
    }
  `, { email: ASSIGNEE_EMAIL });
  return data.users.nodes[0]?.id ?? null;
}

async function createIssue(apiKey, teamId, title, description, assigneeId) {
  const input = { teamId, title, description };
  if (assigneeId) input.assigneeId = assigneeId;
  const data = await linearQuery(apiKey, `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { url }
      }
    }
  `, { input });
  return data.issueCreate;
}

// Parses subject "Re: [repo/name] PR title … (PR #N)" into a ticket title.
function buildTitle(subject) {
  const repoMatch = subject.match(/\[([^\]]+)\]/);
  const repo = repoMatch ? repoMatch[1] : null;
  let prTitle = subject
    .replace(/^Re:\s*/, "")
    .replace(/\[[^\]]+\]\s*/, "")
    .replace(/\s*[…\.]{1,3}\s*\(PR\s*#\d+\)$/, "")
    .replace(/\s*\(PR\s*#\d+\)$/, "")
    .trim();
  return repo ? `Copilot Review Ideas on [${repo}] ${prTitle}` : `Copilot Review Ideas on ${prTitle}`;
}

// Returns only the content after the "generated N comment(s)" divider, or full body.
function extractBody(body) {
  const match = body.match(/changed files in this pull request and generated \d+ comments?\.\n/i);
  if (match) return body.slice(body.indexOf(match[0]) + match[0].length).trim();
  return body;
}

async function loadTeams(apiKey) {
  setStatus("Fetching teams…");
  const teams = await fetchTeams(apiKey);
  const select = $("teamSelect");
  select.innerHTML = "";

  teams.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    select.appendChild(opt);
  });

  const { selectedTeam } = await chrome.storage.local.get("selectedTeam");
  if (selectedTeam) select.value = selectedTeam;

  $("teamRow").style.display = "block";
  $("createBtn").disabled = false;
  setStatus("");
}

async function init() {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (apiKey) {
    $("apiKey").value = apiKey;
    try {
      await loadTeams(apiKey);
    } catch (e) {
      setStatus("Saved API key failed: " + e.message, "error");
    }
  }
}

$("saveKey").addEventListener("click", async () => {
  const apiKey = $("apiKey").value.trim();
  if (!apiKey) return setStatus("Enter an API key.", "error");

  setStatus("Validating…");
  try {
    await chrome.storage.local.set({ apiKey });
    await loadTeams(apiKey);
  } catch (e) {
    setStatus("Invalid API key: " + e.message, "error");
  }
});

$("teamSelect").addEventListener("change", () => {
  chrome.storage.local.set({ selectedTeam: $("teamSelect").value });
});

$("createBtn").addEventListener("click", async () => {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  const teamId = $("teamSelect").value;
  if (!apiKey || !teamId) return setStatus("Missing API key or team.", "error");

  setStatus("Reading email…");
  $("createBtn").disabled = true;

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    setStatus("Could not access active tab.", "error");
    $("createBtn").disabled = false;
    return;
  }

  let emailData;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const subjectEl = document.querySelector('h2.hP');
        const bodyEl = document.querySelector('.a3s.aiL');
        if (!subjectEl || !bodyEl) return null;
        return { subject: subjectEl.innerText.trim(), body: bodyEl.innerText.trim() };
      },
    });
    emailData = result?.result;
  } catch (e) {
    setStatus("Could not access Gmail tab: " + e.message, "error");
    $("createBtn").disabled = false;
    return;
  }

  if (!emailData) {
    setStatus("No email found. Click into a Copilot review email so it's fully open, then try again.", "error");
    $("createBtn").disabled = false;
    return;
  }

  setStatus("Creating ticket…");
  try {
    const title = buildTitle(emailData.subject);
    const description = extractBody(emailData.body);
    const assigneeId = await fetchAssigneeId(apiKey);
    const result = await createIssue(apiKey, teamId, title, description, assigneeId);
    if (result.success) {
      const el = $("status");
      el.innerHTML = `Ticket created: <a href="${result.issue.url}" target="_blank">${result.issue.url}</a>`;
      el.className = "success";
    } else {
      setStatus("Linear returned success=false.", "error");
    }
  } catch (e) {
    setStatus("Error: " + e.message, "error");
  }

  $("createBtn").disabled = false;
});

init();
