const fs = require("fs").promises;
const path = require("path");

// Use Electron's userData directory so memory persists correctly in both
// dev and production (packaged) builds. Resolved lazily so app is ready.
function getMemoryDir() {
  try {
    const { app } = require("electron");
    return path.join(app.getPath("userData"), "ata-data");
  } catch {
    // Fallback for non-Electron environments (tests, etc.)
    return path.join(__dirname, "..", "..", "src", "data");
  }
}

function getMemoryFile() {
  return path.join(getMemoryDir(), "memory.json");
}

const MAX_ITEMS = 50;

const createDefaultMemory = () => ({
  successful_actions: [],
  failed_actions: [],
  observations: [],
});

const normalizeMemory = (memory = {}) => ({
  successful_actions: Array.isArray(memory.successful_actions)
    ? memory.successful_actions.slice(0, MAX_ITEMS)
    : [],
  failed_actions: Array.isArray(memory.failed_actions)
    ? memory.failed_actions.slice(0, MAX_ITEMS)
    : [],
  observations: Array.isArray(memory.observations)
    ? memory.observations.slice(0, MAX_ITEMS)
    : [],
});

async function ensureMemoryFile() {
  const memoryDir  = getMemoryDir();
  const memoryFile = getMemoryFile();
  try {
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.access(memoryFile);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    await fs.writeFile(
      memoryFile,
      JSON.stringify(createDefaultMemory(), null, 2),
      "utf8"
    );
  }
}

async function loadMemory() {
  try {
    await ensureMemoryFile();
    const raw = await fs.readFile(getMemoryFile(), "utf8");
    const parsed = JSON.parse(raw);
    const memory = normalizeMemory(parsed);

    if (JSON.stringify(parsed) !== JSON.stringify(memory)) {
      await saveMemory(memory);
    }

    return memory;
  } catch (error) {
    const fallback = createDefaultMemory();

    try {
      await saveMemory(fallback);
    } catch (_) {
      // Return a safe in-memory fallback if persistence is temporarily unavailable.
    }

    return fallback;
  }
}

async function saveMemory(memory) {
  const normalizedMemory = normalizeMemory(memory);

  try {
    await fs.mkdir(getMemoryDir(), { recursive: true });
    await fs.writeFile(
      getMemoryFile(),
      JSON.stringify(normalizedMemory, null, 2),
      "utf8"
    );
  } catch (error) {
    return normalizedMemory;
  }

  return normalizedMemory;
}

async function addUniqueItem(key, value) {
  if (typeof value !== "string") {
    return loadMemory();
  }

  const item = value.trim();

  if (!item) {
    return loadMemory();
  }

  const memory = await loadMemory();
  const existingItems = Array.isArray(memory[key]) ? memory[key] : [];

  if (!existingItems.includes(item)) {
    memory[key] = [...existingItems, item].slice(-MAX_ITEMS);
    return saveMemory(memory);
  }

  return memory;
}

async function addSuccessfulAction(action) {
  return addUniqueItem("successful_actions", action);
}

async function addFailedAction(action) {
  return addUniqueItem("failed_actions", action);
}

async function addObservation(note) {
  return addUniqueItem("observations", note);
}

async function getSummary() {
  const memory = await loadMemory();

  return {
    recent_successes: memory.successful_actions.slice(-10),
    recent_failures: memory.failed_actions.slice(-10),
  };
}

module.exports = {
  loadMemory,
  saveMemory,
  addSuccessfulAction,
  addFailedAction,
  addObservation,
  getSummary,
};
