export type ChatGPTInsertResult =
  | { status: 'inserted' }
  | { status: 'needs-confirmation'; signature: string }
  | { status: 'changed' }
  | { status: 'unsupported' };

/** Injects only into the active ChatGPT tab, after an explicit user action. */
export async function insertIntoChatGPT(text: string, expectedSignature?: string): Promise<ChatGPTInsertResult> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) throw new Error('Open ChatGPT in the active tab before inserting a prompt.');
  let hostname = '';
  try {
    const url = new URL(tab.url);
    if (url.protocol === 'https:') hostname = url.hostname;
  } catch {
    // Report unsupported/local pages using the same safe message below.
  }
  if (hostname !== 'chatgpt.com' && hostname !== 'chat.openai.com') {
    throw new Error('Prompt insertion is available only on ChatGPT. Open ChatGPT in the active tab and try again.');
  }

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: writePromptIntoChatGPT,
    args: [text, Boolean(expectedSignature), expectedSignature ?? null],
  });
  if (!injection?.result) throw new Error('Could not access the ChatGPT prompt field. Refresh the page and try again.');
  if (injection.result.status === 'unsupported') {
    throw new Error('Could not find ChatGPT’s prompt field. Refresh the page and try again.');
  }
  return injection.result;
}

/** This function is serialized by chrome.scripting; keep it self-contained. */
function writePromptIntoChatGPT(
  prompt: string,
  allowReplace: boolean,
  expectedSignature: string | null,
): ChatGPTInsertResult {
  const field = document.querySelector<HTMLElement>(
    '[data-testid="prompt-textarea"], textarea#prompt-textarea, #prompt-textarea[contenteditable="true"]',
  );
  if (!field) return { status: 'unsupported' };

  const getText = () => field instanceof HTMLTextAreaElement ? field.value : field.innerText;
  const currentText = getText();
  let hash = 2166136261;
  for (let index = 0; index < currentText.length; index += 1) {
    hash = Math.imul(hash ^ currentText.charCodeAt(index), 16777619);
  }
  const signature = `${currentText.length}:${hash >>> 0}`;
  if (currentText.trim() && !allowReplace) return { status: 'needs-confirmation', signature };
  if (currentText.trim() && signature !== expectedSignature) return { status: 'changed' };

  field.focus();
  if (field instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(field, prompt);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(field);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const usedEditorCommand = document.execCommand('insertText', false, prompt);
    if (!usedEditorCommand || getText() !== prompt) {
      field.textContent = prompt;
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
    }
  }
  return { status: 'inserted' };
}
