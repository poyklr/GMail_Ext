// Extracts the open email's subject and body from Gmail's DOM
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action !== "getEmailContent") return;

  const subjectEl = document.querySelector('h2.hP');
  // Gmail renders the decoded email body inside .a3s.aiL
  const bodyEl = document.querySelector('.a3s.aiL');

  if (!subjectEl || !bodyEl) {
    sendResponse({ error: "No email open. Open a Copilot review email and try again." });
    return;
  }

  sendResponse({
    subject: subjectEl.innerText.trim(),
    body: bodyEl.innerText.trim(),
  });
});
