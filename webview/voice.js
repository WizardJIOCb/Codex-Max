// Voice input, Local Whisper live transcription, and transcript cleanup. Loaded before main.js.
function speechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function voiceShortcutLabel(value) {
  const shortcut = normalizeVoiceShortcut(value);
  if (shortcut === "alt-v") {
    return "Alt+V";
  }
  if (shortcut === "ctrl-shift-v") {
    return "Ctrl+Shift+V";
  }
  if (shortcut === "ctrl-m") {
    return "Ctrl+M";
  }
  return "Off";
}

function voiceButtonTitle(chatId) {
  const board = normalizeBoardSettings(state.boardSettings);
  const shortcut = voiceShortcutLabel(board.voiceShortcut);
  if (board.speechToText === "off") {
    return "Voice input is disabled in workspace settings";
  }
  if (board.speechToText === "browser" && !speechRecognitionConstructor()) {
    return "Voice input unavailable in this VS Code webview";
  }
  if (voiceChatId === chatId) {
    if (nativeWhisperStopping) {
      return "Finishing Local Whisper transcription...";
    }
    return (board.speechToText === "local-whisper" ? "Stop Local Whisper live input" : "Stop voice input") + (shortcut === "Off" ? "" : " (" + shortcut + ")");
  }
  const engine = board.speechToText === "local-whisper" ? "Local Whisper" : "Voice input";
  return engine + (shortcut === "Off" ? "" : " (" + shortcut + ")");
}

function toggleVoiceInput(chatId) {
  if ((voiceRecognition || localVoiceSession || nativeWhisperLive || nativeWhisperStopping) && voiceChatId === chatId) {
    stopVoiceInput();
    return;
  }

  startVoiceInput(chatId);
}

function startVoiceInput(chatId) {
  if (nativeWhisperStopping) {
    return;
  }
  stopVoiceInput();
  const board = normalizeBoardSettings(state.boardSettings);
  const Recognition = speechRecognitionConstructor();
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  const textarea = card ? card.querySelector(".promptInput") : null;
  if (board.speechToText === "off") {
    addVoiceActivity(chatId, "Voice input is disabled in workspace settings.");
    return;
  }
  if (board.speechToText === "local-whisper") {
    startLocalWhisperInput(chatId, chat, textarea, board);
    return;
  }
  if (!Recognition || !chat || !textarea || chat.status === "running") {
    if (!Recognition) {
      addVoiceActivity(chatId, "Voice input is not available in this VS Code webview. Current engine: Browser Web Speech.");
    }
    return;
  }

  const recognition = new Recognition();
  voiceRecognition = recognition;
  voiceChatId = chatId;
  voiceBaseText = textarea.value.trim();

  recognition.lang = navigator.language || "ru-RU";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let transcript = "";
    for (let index = 0; index < event.results.length; index += 1) {
      transcript += event.results[index][0] && event.results[index][0].transcript
        ? event.results[index][0].transcript
        : "";
    }

    const nextText = [voiceBaseText, transcript.trim()].filter(Boolean).join(" ");
    textarea.value = nextText;
    chat.draftPrompt = nextText;
    chat.updatedAt = Date.now();
    resizePromptInput(textarea);
    syncActiveWorkspaceChat(chat.id);
    persist({ skipFullSync: true });
  };

  recognition.onerror = (event) => {
    const reason = event && event.error ? String(event.error) : "recognition error";
    addVoiceActivity(chatId, "Voice input stopped: " + reason + ".");
    stopVoiceInput(false);
  };

  recognition.onend = () => {
    if (voiceRecognition === recognition) {
      stopVoiceInput(false);
    }
  };

  updateVoiceButtons();
  try {
    recognition.start();
    textarea.focus();
  } catch {
    addVoiceActivity(chatId, "Voice input could not be started in this VS Code webview.");
    stopVoiceInput(false);
  }
}

function startLocalWhisperInput(chatId, chat, textarea, board) {
  if (!chat || !textarea || chat.status === "running") {
    return;
  }

  voiceChatId = chatId;
  voiceBaseText = textarea.value.trim();
  nativeWhisperLive = true;
  nativeWhisperStopping = false;
  nativeWhisperChunks = [];
  updateVoiceButtons();
  textarea.focus();
  vscode.postMessage({
    type: "startWhisperLive",
    chatId,
    modelId: board.localWhisperModel,
    captureId: board.localWhisperCaptureId
  });
}

function finishLocalWhisperInput(session, shouldTranscribe) {
  try {
    session.processor.disconnect();
  } catch {}
  try {
    session.source.disconnect();
  } catch {}
  try {
    session.stream.getTracks().forEach((track) => track.stop());
  } catch {}
  try {
    session.audioContext.close();
  } catch {}

  if (!shouldTranscribe) {
    return;
  }

  const samples = mergeAudioChunks(session.chunks);
  if (!samples.length) {
    addVoiceActivity(session.chatId, "Local Whisper did not capture any audio.");
    return;
  }

  addVoiceActivity(session.chatId, "Local Whisper is transcribing...");
  const wav = encodeWav(samples, session.sampleRate);
  vscode.postMessage({
    type: "transcribeWhisperAudio",
    chatId: session.chatId,
    modelId: session.modelId,
    dataUri: "data:audio/wav;base64," + arrayBufferToBase64(wav)
  });
}

function mergeAudioChunks(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function stopVoiceInput(callStop) {
  const recognition = voiceRecognition;
  const localSession = localVoiceSession;
  const nativeChatId = nativeWhisperLive || nativeWhisperStopping ? voiceChatId : "";
  voiceRecognition = null;
  localVoiceSession = null;
  if (nativeChatId && callStop !== false) {
    nativeWhisperLive = false;
    nativeWhisperStopping = true;
  } else {
    nativeWhisperLive = false;
    nativeWhisperStopping = false;
    voiceChatId = "";
    voiceBaseText = "";
    nativeWhisperChunks = [];
  }
  if (recognition && callStop !== false) {
    try {
      recognition.stop();
    } catch {
      // The browser speech engine may already be stopped.
    }
  }
  if (localSession) {
    finishLocalWhisperInput(localSession, callStop !== false);
  }
  if (nativeChatId && callStop !== false) {
    const board = normalizeBoardSettings(state.boardSettings);
    vscode.postMessage({
      type: "stopWhisperLive",
      chatId: nativeChatId,
      stopGraceMs: board.localWhisperStopGraceMs
    });
  }
  updateVoiceButtons();
}

function updateVoiceButtons() {
  const Recognition = speechRecognitionConstructor();
  const board = normalizeBoardSettings(state.boardSettings);
  for (const button of document.querySelectorAll("[data-action='voice']")) {
    const card = button.closest("[data-chat-id]");
    const active = card && card.dataset.chatId === voiceChatId;
    const unavailable = board.speechToText === "browser" && !Recognition;
    button.classList.toggle("listening", Boolean(active && !nativeWhisperStopping));
    button.classList.toggle("stopping", Boolean(active && nativeWhisperStopping));
    button.classList.toggle("unavailable", Boolean(unavailable));
    button.title = card ? voiceButtonTitle(card.dataset.chatId) : voiceButtonTitle("");
  }
}

function pickLocalWhisperAudioFile(chatId) {
  const board = normalizeBoardSettings(state.boardSettings);
  if (board.speechToText !== "local-whisper") {
    addVoiceActivity(chatId, "Select Local Whisper in Board settings before transcribing audio files.");
    return;
  }

  vscode.postMessage({
    type: "pickWhisperAudioFile",
    chatId,
    modelId: board.localWhisperModel
  });
}

function addVoiceActivity(chatId, text) {
  const chat = state.chats.find((item) => item.id === chatId);
  if (!chat) {
    return;
  }

  chat.messages.push({
    role: "activity",
    text,
    at: Date.now()
  });
  chat.updatedAt = Date.now();
  syncActiveWorkspaceChat(chatId);
  scheduleChatCardRender(chatId);
  persist({ skipFullSync: true });
}

function applyVoiceTranscription(chatId, text) {
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  const textarea = card ? card.querySelector(".promptInput") : null;
  const transcript = String(text || "").trim();
  if (!chat || !textarea || !transcript) {
    addVoiceActivity(chatId, "Local Whisper returned an empty transcript.");
    return;
  }

  const base = textarea.value.trim() || voiceBaseText;
  const nextText = [base, transcript].filter(Boolean).join(" ");
  textarea.value = nextText;
  chat.draftPrompt = nextText;
  chat.updatedAt = Date.now();
  resizePromptInput(textarea);
  textarea.focus();
  syncActiveWorkspaceChat(chat.id);
  persist({ skipFullSync: true });
}

function applyWhisperLiveText(chatId, text) {
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  const textarea = card ? card.querySelector(".promptInput") : null;
  const chunk = collapseWhisperRepeats(String(text || "").trim());
  if (!chat || !textarea || !chunk) {
    return;
  }

  const lastChunk = nativeWhisperChunks[nativeWhisperChunks.length - 1] || "";
  if (lastChunk === chunk) {
    return;
  }

  const mergedWithLast = lastChunk ? mergeWhisperChunks(lastChunk, chunk) : "";
  if (mergedWithLast) {
    nativeWhisperChunks[nativeWhisperChunks.length - 1] = mergedWithLast;
  } else {
    const duplicateIndex = findSimilarWhisperChunk(nativeWhisperChunks, chunk);
    if (duplicateIndex >= 0) {
      const previous = nativeWhisperChunks[duplicateIndex];
      nativeWhisperChunks[duplicateIndex] = collapseWhisperRepeats(chooseBetterWhisperChunk(previous, chunk));
    } else if (lastChunk && (chunk.startsWith(lastChunk) || lastChunk.startsWith(chunk) || whisperChunksOverlap(lastChunk, chunk))) {
      nativeWhisperChunks[nativeWhisperChunks.length - 1] = collapseWhisperRepeats(chooseBetterWhisperChunk(lastChunk, chunk));
    } else {
      nativeWhisperChunks.push(chunk);
    }
  }
  if (nativeWhisperChunks.length > 80) {
    nativeWhisperChunks = nativeWhisperChunks.slice(-80);
  }

  const base = voiceBaseText || "";
  const nextText = collapseWhisperRepeats([base, nativeWhisperChunks.join(" ")].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
  textarea.value = nextText;
  chat.draftPrompt = nextText;
  chat.updatedAt = Date.now();
  resizePromptInput(textarea);
  syncActiveWorkspaceChat(chat.id);
  persist({ skipFullSync: true });
}

function applyWhisperLiveFinalText(chatId, text) {
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  const textarea = card ? card.querySelector(".promptInput") : null;
  const transcript = collapseWhisperRepeats(String(text || "").trim());
  if (isLikelyWhisperSubtitleCredit(transcript)) {
    return;
  }
  if (!chat || !textarea || !transcript) {
    return;
  }

  const finalTranscript = preserveLiveLeadingPrefix(nativeWhisperChunks.join(" "), transcript);
  nativeWhisperChunks = [finalTranscript];
  const base = voiceBaseText || "";
  const nextText = collapseWhisperRepeats([base, finalTranscript].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
  textarea.value = nextText;
  chat.draftPrompt = nextText;
  chat.updatedAt = Date.now();
  resizePromptInput(textarea);
  syncActiveWorkspaceChat(chat.id);
  persist({ skipFullSync: true });
}

function whisperChunksOverlap(previous, next) {
  const prevWords = String(previous || "").toLowerCase().split(/\s+/).filter(Boolean);
  const nextWords = String(next || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!prevWords.length || !nextWords.length) {
    return false;
  }

  const max = Math.min(5, prevWords.length, nextWords.length);
  for (let count = max; count >= 2; count -= 1) {
    if (prevWords.slice(-count).join(" ") === nextWords.slice(0, count).join(" ")) {
      return true;
    }
  }
  return false;
}

function preserveLiveLeadingPrefix(liveText, finalText) {
  const liveParts = String(liveText || "").trim().split(/\s+/).filter(Boolean);
  const finalParts = String(finalText || "").trim().split(/\s+/).filter(Boolean);
  if (liveParts.length < 2 || finalParts.length < 2) {
    return String(finalText || "").trim();
  }

  const liveWords = liveParts.map(normalizeWhisperWord);
  const finalWords = finalParts.map(normalizeWhisperWord);
  const maxSkip = Math.min(3, liveWords.length - 1);
  for (let skip = 1; skip <= maxSkip; skip += 1) {
    const prefix = liveParts.slice(0, skip);
    if (!isShortWhisperPrefix(prefix)) {
      continue;
    }

    const common = commonWhisperPrefix(liveWords.concat(finalWords), skip, liveWords.length);
    if (common >= Math.min(4, finalWords.length, liveWords.length - skip)) {
      return collapseWhisperRepeats(prefix.concat(finalParts).join(" "));
    }
  }

  return String(finalText || "").trim();
}

function isShortWhisperPrefix(parts) {
  const text = parts.join(" ").toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, "").trim();
  if (!text) {
    return false;
  }
  if (text.length <= 8) {
    return true;
  }
  return /^(ну|а|и|так|да|вот|ладно|короче)(\s|$)/i.test(text);
}

function mergeWhisperChunks(previous, next) {
  const prevParts = String(previous || "").trim().split(/\s+/).filter(Boolean);
  const nextParts = String(next || "").trim().split(/\s+/).filter(Boolean);
  if (prevParts.length < 3 || nextParts.length < 3) {
    return "";
  }

  const prevWords = prevParts.map(normalizeWhisperWord);
  const nextWords = nextParts.map(normalizeWhisperWord);
  const prefix = commonWhisperPrefix(prevWords.concat(nextWords), 0, prevWords.length);
  if (prefix >= 3 && prefix >= Math.min(prevWords.length, nextWords.length) * 0.55) {
    return collapseWhisperRepeats((nextParts.length >= prevParts.length ? nextParts : prevParts).join(" "));
  }

  const best = bestWhisperOverlap(prevWords, nextWords);
  if (!best || best.count < 3) {
    return "";
  }

  const prevCoverage = best.count / Math.max(1, prevWords.length - best.prevStart);
  const nextCoverage = best.count / Math.max(1, Math.min(nextWords.length, best.nextStart + best.count) - best.nextStart);
  if (prevCoverage < 0.55 || nextCoverage < 0.55) {
    return "";
  }

  if (best.nextStart === 0) {
    return collapseWhisperRepeats(prevParts.slice(0, best.prevStart).concat(nextParts).join(" "));
  }

  return collapseWhisperRepeats(prevParts.slice(0, best.prevStart + best.count).concat(nextParts.slice(best.nextStart + best.count)).join(" "));
}

function bestWhisperOverlap(prevWords, nextWords) {
  let best = null;
  const minPrevStart = Math.max(0, prevWords.length - 12);
  const maxNextStart = Math.min(4, nextWords.length - 1);
  for (let prevStart = minPrevStart; prevStart < prevWords.length; prevStart += 1) {
    for (let nextStart = 0; nextStart <= maxNextStart; nextStart += 1) {
      const count = commonWhisperPrefix(prevWords.concat(nextWords), prevStart, prevWords.length + nextStart);
      if (count < 2) {
        continue;
      }
      const reachesPrevEnd = prevStart + count >= prevWords.length - 1;
      if (!reachesPrevEnd) {
        continue;
      }
      if (!best || count > best.count || (count === best.count && nextStart < best.nextStart)) {
        best = { prevStart, nextStart, count };
      }
    }
  }
  return best;
}

function collapseWhisperRepeats(value) {
  let text = stripLikelyWhisperSubtitleCredits(String(value || "").replace(/\s+/g, " ").trim());
  if (!text) {
    return "";
  }

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const collapsed = collapseRepeatedWhisperPrefix(text);
    if (collapsed === text) {
      break;
    }
    text = collapsed;
  }
  return text;
}

function isLikelyWhisperSubtitleCredit(value) {
  const normalized = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 220) {
    return false;
  }

  return [
    /редактор(?:ы)?\s+субтитров/,
    /корректор\s+[а-яa-z.]+/,
    /субтитр(?:ы|ов).{0,24}(?:редактор|корректор|сделал|сделала|создал|создала)/,
    /(?:редакция|тайминг|перевод).{0,24}субтитр/,
    /subtitles?\s+(?:by|edited|editor|correction)/,
    /subtitle\s+(?:editor|correction|corrections)/
  ].some((pattern) => pattern.test(normalized));
}

function isLikelyWhisperSubtitleCredit(value) {
  const normalized = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 260) {
    return false;
  }

  return whisperSubtitleCreditPatterns().some((pattern) => pattern.test(normalized));
}

function stripLikelyWhisperSubtitleCredits(value) {
  return String(value || "")
    .replace(whisperSubtitleCreditInfixPattern(), " ")
    .replace(whisperSubtitleCreditSuffixPattern(), "")
    .replace(/\s+/g, " ")
    .trim();
}

function whisperSubtitleCreditPatterns() {
  return [
    /\u0441\u0443\u0431\u0442\u0438\u0442\u0440(?:\u044b|\u043e\u0432)\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432/u,
    /\u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440(?:\u044b)?\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432/u,
    /\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440\s+[\u0430-\u044fa-z.]+/u,
    /\u0441\u0443\u0431\u0442\u0438\u0442\u0440(?:\u044b|\u043e\u0432).{0,32}(?:\u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440|\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440|\u0441\u0434\u0435\u043b\u0430\u043b|\u0441\u0434\u0435\u043b\u0430\u043b\u0430|\u0441\u043e\u0437\u0434\u0430\u043b|\u0441\u043e\u0437\u0434\u0430\u043b\u0430)/u,
    /(?:\u0440\u0435\u0434\u0430\u043a\u0446\u0438\u044f|\u0442\u0430\u0439\u043c\u0438\u043d\u0433|\u043f\u0435\u0440\u0435\u0432\u043e\u0434).{0,32}\u0441\u0443\u0431\u0442\u0438\u0442\u0440/u,
    /subtitles?\s+(?:by|edited|editor|correction)/,
    /subtitle\s+(?:editor|correction|corrections)/
  ];
}

function whisperSubtitleCreditSuffixPattern() {
  return /\s*(?:\u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440(?:\u044b)?\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432[\s\S]*|\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440\s+[\u0410-\u044f\u0401\u0451A-Za-z.\-\s]+|subtitles?\s+(?:by|edited|editor|correction)[\s\S]*|subtitle\s+(?:editor|correction|corrections)[\s\S]*)$/iu;
}

function whisperSubtitleCreditInfixPattern() {
  return /(?:\u0441\u0443\u0431\u0442\u0438\u0442\u0440(?:\u044b|\u043e\u0432)\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432\s+[\u0410-\u044f\u0401\u0451A-Za-z.]+|\u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440(?:\u044b)?\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432\s+[\u0410-\u044f\u0401\u0451A-Za-z.\-\s]{1,48}|\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440\s+[\u0410-\u044f\u0401\u0451A-Za-z.]+|subtitles?\s+(?:by|edited|editor|correction)\s+[A-Za-z.\-\s]{1,48}|subtitle\s+(?:editor|correction|corrections)\s+[A-Za-z.\-\s]{1,48})/giu;
}

function isSilentWhisperStopError(value) {
  const normalized = String(value || "").toLowerCase();
  return normalized.includes("whisper returned an empty transcript")
    || normalized.includes("empty transcript")
    || isLikelyWhisperSubtitleCredit(normalized);
}

function collapseRepeatedWhisperPrefix(value) {
  const text = String(value || "").trim();
  const parts = text.split(/\s+/);
  if (parts.length < 6) {
    return text;
  }

  const words = parts.map(normalizeWhisperWord);
  const maxStart = Math.min(Math.floor(parts.length / 2), 14);
  for (let start = 3; start <= maxStart; start += 1) {
    const common = commonWhisperPrefix(words, 0, start);
    if (common < 3) {
      continue;
    }

    const coverage = common / start;
    if (coverage >= 0.62) {
      return parts.slice(start).join(" ").replace(/^[,.!?;:…-]+\s*/, "").trim();
    }
  }

  const sentenceMatch = /^(.{12,160}?[.!?…])\s+(.+)$/u.exec(text);
  if (sentenceMatch) {
    const firstWords = normalizeWhisperWords(sentenceMatch[1]);
    const restWords = normalizeWhisperWords(sentenceMatch[2]);
    const common = commonWhisperPrefix(firstWords.concat(restWords), 0, firstWords.length);
    if (firstWords.length >= 3 && common / firstWords.length >= 0.62) {
      return sentenceMatch[2].trim();
    }
  }

  return text;
}

function commonWhisperPrefix(words, leftStart, rightStart) {
  let count = 0;
  while (leftStart + count < words.length && rightStart + count < words.length) {
    if (!whisperWordsSimilar(words[leftStart + count], words[rightStart + count])) {
      break;
    }
    count += 1;
  }
  return count;
}

function whisperWordsSimilar(left, right) {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  if (left.length < 4 || right.length < 4) {
    return false;
  }
  return left.startsWith(right.slice(0, 4)) || right.startsWith(left.slice(0, 4));
}

function findSimilarWhisperChunk(chunks, chunk) {
  const start = Math.max(0, chunks.length - 4);
  for (let index = chunks.length - 1; index >= start; index -= 1) {
    if (whisperChunkSimilarity(chunks[index], chunk) >= 0.58) {
      return index;
    }
  }
  return -1;
}

function chooseBetterWhisperChunk(previous, next) {
  const prev = String(previous || "").trim();
  const candidate = String(next || "").trim();
  if (!prev) {
    return candidate;
  }
  if (!candidate) {
    return prev;
  }
  return candidate.length >= prev.length ? candidate : prev;
}

function whisperChunkSimilarity(left, right) {
  const leftWords = normalizeWhisperWords(left);
  const rightWords = normalizeWhisperWords(right);
  if (!leftWords.length || !rightWords.length) {
    return 0;
  }

  const leftSet = new Set(leftWords);
  const rightSet = new Set(rightWords);
  let overlap = 0;
  for (const word of leftSet) {
    if (rightSet.has(word)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftSet.size, rightSet.size);
}

function normalizeWhisperWords(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

function normalizeWhisperWord(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
