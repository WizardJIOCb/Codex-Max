const { getWhisperRuntimeDescriptor } = require("./platform");

const DEFAULT_WHISPER_LIVE_STOP_GRACE_MS = 2600;
const WHISPER_RELEASE_TAG = "v1.9.1";
const WHISPER_RUNTIME_BASE_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE_TAG}`;

const WHISPER_RUNTIME_BY_PLATFORM = {
  "win32-x64": {
    id: "whisper.cpp-win32-x64",
    label: "whisper.cpp Windows x64",
    platform: "Windows x64",
    archiveName: "whisper-bin-x64.zip",
    archiveType: "zip",
    executable: ["runtime", "Release", "whisper-cli.exe"],
    streamExecutable: ["runtime", "Release", "whisper-stream.exe"],
    benchExecutable: ["runtime", "Release", "whisper-bench.exe"],
    cliNames: ["whisper-cli.exe"],
    streamNames: ["whisper-stream.exe"],
    benchNames: ["whisper-bench.exe"],
    supported: true
  },
  "win32-ia32": {
    id: "whisper.cpp-win32-ia32",
    label: "whisper.cpp Windows Win32",
    platform: "Windows Win32",
    archiveName: "whisper-bin-Win32.zip",
    archiveType: "zip",
    executable: ["runtime", "Release", "whisper-cli.exe"],
    streamExecutable: ["runtime", "Release", "whisper-stream.exe"],
    benchExecutable: ["runtime", "Release", "whisper-bench.exe"],
    cliNames: ["whisper-cli.exe"],
    streamNames: ["whisper-stream.exe"],
    benchNames: ["whisper-bench.exe"],
    supported: true
  },
  "linux-x64": {
    id: "whisper.cpp-linux-x64",
    label: "whisper.cpp Ubuntu x64",
    platform: "Linux x64",
    archiveName: "whisper-bin-ubuntu-x64.tar.gz",
    archiveType: "tar.gz",
    executable: ["runtime", "whisper-cli"],
    streamExecutable: ["runtime", "whisper-stream"],
    benchExecutable: ["runtime", "whisper-bench"],
    cliNames: ["whisper-cli"],
    streamNames: ["whisper-stream"],
    benchNames: ["whisper-bench"],
    supported: true
  },
  "linux-arm64": {
    id: "whisper.cpp-linux-arm64",
    label: "whisper.cpp Ubuntu arm64",
    platform: "Linux arm64",
    archiveName: "whisper-bin-ubuntu-arm64.tar.gz",
    archiveType: "tar.gz",
    executable: ["runtime", "whisper-cli"],
    streamExecutable: ["runtime", "whisper-stream"],
    benchExecutable: ["runtime", "whisper-bench"],
    cliNames: ["whisper-cli"],
    streamNames: ["whisper-stream"],
    benchNames: ["whisper-bench"],
    supported: true
  }
};

for (const runtime of Object.values(WHISPER_RUNTIME_BY_PLATFORM)) {
  runtime.url = `${WHISPER_RUNTIME_BASE_URL}/${runtime.archiveName}`;
}

const WHISPER_RUNTIME = getWhisperRuntimeDescriptor(WHISPER_RUNTIME_BY_PLATFORM);

const LOCAL_WHISPER_MODELS = [
  {
    id: "tiny-q5_1",
    label: "Whisper tiny q5_1",
    size: "31 MB",
    description: "Very fast, rough quality, good for quick tests",
    file: "ggml-tiny-q5_1.bin"
  },
  {
    id: "base-q5_1",
    label: "Whisper base q5_1",
    size: "57 MB",
    description: "Fast, acceptable Russian quality",
    file: "ggml-base-q5_1.bin"
  },
  {
    id: "base-q8_0",
    label: "Whisper base q8_0",
    size: "78 MB",
    description: "Fast, a bit cleaner than base q5_1",
    file: "ggml-base-q8_0.bin"
  },
  {
    id: "small-q5_1",
    label: "Whisper small q5_1",
    size: "181 MB",
    description: "Recommended balance for Russian",
    file: "ggml-small-q5_1.bin"
  },
  {
    id: "small-q8_0",
    label: "Whisper small q8_0",
    size: "252 MB",
    description: "Better small model quality, still reasonably fast",
    file: "ggml-small-q8_0.bin"
  },
  {
    id: "medium-q5_0",
    label: "Whisper medium q5_0",
    size: "514 MB",
    description: "Better quality, slower",
    file: "ggml-medium-q5_0.bin"
  },
  {
    id: "large-v3-turbo-q5_0",
    label: "Whisper large-v3 turbo q5_0",
    size: "547 MB",
    description: "High quality, still reasonably fast",
    file: "ggml-large-v3-turbo-q5_0.bin"
  },
  {
    id: "large-v3-turbo-q8_0",
    label: "Whisper large-v3 turbo q8_0",
    size: "834 MB",
    description: "Higher quality turbo, heavier and slower to load",
    file: "ggml-large-v3-turbo-q8_0.bin"
  },
  {
    id: "large-v3-turbo-russian-q5_k",
    label: "Whisper large-v3 turbo Russian q5_k",
    size: "574 MB",
    description: "Russian fine-tune, better Russian recognition, slower",
    file: "ggml-large-v3-turbo-russian-q5_k.bin",
    url: "https://huggingface.co/MECHUK/whisper-large-v3-turbo-russian/resolve/main/ggml-large-v3-turbo-russian-q5_k.bin"
  }
].map((model) => Object.assign({}, model, {
  url: model.url || `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${model.file}`
}));

module.exports = {
  DEFAULT_WHISPER_LIVE_STOP_GRACE_MS,
  LOCAL_WHISPER_MODELS,
  WHISPER_RUNTIME,
  WHISPER_RUNTIME_BY_PLATFORM
};
