const LINEAR_API = "https://api.linear.app/graphql";

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

async function createIssue(apiKey, teamId, title, description) {
  const data = await linearQuery(apiKey, `
    mutation CreateIssue($teamId: String!, $title: String!, $description: String!) {
      issueCreate(input: { teamId: $teamId, title: $title, description: $description }) {
        success
        issue { url }
      }
    }
  `, { teamId, title, description });
  return data.issueCreate;
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

  // Restore previously selected team
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

  {
    const { subject, body } = emailData;
    setStatus("Creating ticket…");

    try {
      const result = await createIssue(apiKey, teamId, subject, body);
      if (result.success) {
        setStatus("", "");
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
  }
});

init();
