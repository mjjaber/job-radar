// Service workers cannot call URL.createObjectURL, so blob URLs are minted here.
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || msg.target !== "offscreen") return;
  if (msg.type === "blob") {
    respond({ url: URL.createObjectURL(new Blob([msg.text], { type: msg.mime })) });
  } else if (msg.type === "revoke") {
    URL.revokeObjectURL(msg.url);
    respond({ ok: true });
  }
  return true;
});
