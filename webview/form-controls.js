// Shared select and model control rendering helpers. Loaded before chat rendering.
function option(value, label, selectedValue) {
  return '<option value="' + escapeAttr(value) + '"' + (value === selectedValue ? " selected" : "") + '>' + escapeHtml(label) + '</option>';
}

function selectChip(setting, title, selectedValue, choices, disabled) {
  const label = selectedLabel(selectedValue, choices);
  const options = choices.map((item) => ({
    value: item[0],
    label: item[1]
  }));
  return `
    <button class="selectChip" type="button" data-select-setting="${escapeAttr(setting)}" data-select-value="${escapeAttr(selectedValue)}" data-select-options="${escapeAttr(JSON.stringify(options))}" title="${escapeAttr(title)}" ${disabled ? "disabled" : ""}>
      <span class="selectChipText">${escapeHtml(label)}</span>
    </button>
  `;
}

function selectedLabel(selectedValue, choices) {
  const found = choices.find((item) => item[0] === selectedValue);
  return found ? found[1] : String(selectedValue || "");
}

function modelSelectChip(selectedValue, disabled) {
  let selected = normalizeModelId(selectedValue) || "gpt-5.5";
  const choices = modelChoices(selected);
  if (!choices.some((item) => item[0] === selected)) {
    selected = choices[0] ? choices[0][0] : selected;
  }
  return selectChip("model", "Model", selected, choices, disabled);
}

function modelOptions(selectedValue) {
  let selected = normalizeModelId(selectedValue) || "gpt-5.5";
  const choices = modelChoices(selected);
  if (!choices.some((item) => item[0] === selected)) {
    selected = choices[0] ? choices[0][0] : selected;
  }
  return choices.map((item) => option(item[0], item[1], selected)).join("");
}

function modelDisplayLabel(value) {
  let selected = normalizeModelId(value) || "gpt-5.5";
  const choices = modelChoices(selected);
  if (!choices.some((item) => item[0] === selected)) {
    selected = choices[0] ? choices[0][0] : selected;
  }
  const match = choices.find((item) => item[0] === selected);
  return match ? match[1] : selected;
}

function modelChoices(selected) {
  const runner = normalizeAgentRunner(state && state.boardSettings ? state.boardSettings.agentRunner : "codex");
  const provider = normalizeModelProvider(state && state.boardSettings ? state.boardSettings.modelProvider : "codex");
  if (runner === "grok") {
    const grokModels = [
      ["grok-build", "grok-build"],
      ["grok-4.5", "grok-4.5"]
    ];
    if (selected && !grokModels.some((item) => item[0] === selected) && /^grok-/i.test(selected)) {
      grokModels.push([selected, selected]);
    }
    return grokModels;
  }

  const models = [
    ["gpt-5.5", "5.5"],
    ["gpt-5.4", "5.4"],
    ["gpt-5.3", "5.3"],
    ["o3", "o3"],
    ["o4-mini", "o4-mini"]
  ];

  if (provider === "xai") {
    models.push(["grok-4.5", "grok-4.5"]);
  } else if (provider === "openrouter") {
    models.push(["x-ai/grok-4.5", "grok-4.5"]);
  }

  if (selected && !models.some((item) => item[0] === selected)) {
    models.push([selected, selected]);
  }

  return models;
}
