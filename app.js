// State
let clips = [];
let ffmpeg = null;

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const clipQueue = document.getElementById('clip-queue');
const queueEmpty = document.getElementById('queue-empty');
const stitchBtn = document.getElementById('stitch-btn');

// Initialize event listeners
function init() {
    // File upload events
    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    // Drag and drop events
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    ['dragleave', 'dragend'].forEach(type => {
        dropZone.addEventListener(type, (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
        });
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
        }
    });

    stitchBtn.addEventListener('click', processClips);
}

// Handle selected files
function handleFileSelect(e) {
    if (e.target.files.length > 0) {
        handleFiles(e.target.files);
    }
    // Reset input so same file can be selected again if needed
    e.target.value = '';
}

// Process raw files into clip state
function handleFiles(files) {
    const newClips = Array.from(files)
        .filter(file => file.type.startsWith('video/') || file.name.endsWith('.mp4'))
        .map(file => ({
            id: generateId(),
            file: file,
            name: file.name,
            size: formatBytes(file.size),
            trimStart: 0,
            trimEnd: '' // empty means end of file
        }));

    if (newClips.length > 0) {
        clips = [...clips, ...newClips];
        renderQueue();
    } else {
        alert('Please upload valid video files (MP4).');
    }
}

// Generate unique ID
function generateId() {
    return Math.random().toString(36).substring(2, 9);
}

// Format bytes to human readable
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Render the clip queue UI
function renderQueue() {
    clipQueue.innerHTML = '';

    if (clips.length === 0) {
        queueEmpty.style.display = 'block';
        stitchBtn.disabled = true;
        return;
    }

    queueEmpty.style.display = 'none';
    stitchBtn.disabled = clips.length < 2; // Need at least 2 to join, though strictly 1 is possible, let's allow 1+
    if(clips.length >= 1) stitchBtn.disabled = false;

    clips.forEach((clip, index) => {
        const item = document.createElement('div');
        item.className = 'queue-item';

        item.innerHTML = `
            <div class="queue-controls">
                <button class="btn icon-btn" onclick="moveClip(${index}, -1)" ${index === 0 ? 'disabled' : ''}>▲</button>
                <button class="btn icon-btn" onclick="moveClip(${index}, 1)" ${index === clips.length - 1 ? 'disabled' : ''}>▼</button>
            </div>

            <div class="clip-info">
                <div class="clip-name" title="${clip.name}">${index + 1}. ${clip.name}</div>
                <div class="clip-meta">${clip.size}</div>
            </div>

            <div class="trim-controls">
                <div class="trim-group">
                    <label>Start (sec)</label>
                    <input type="number" class="trim-input" min="0" step="0.1" value="${clip.trimStart}" onchange="updateTrim('${clip.id}', 'start', this.value)">
                </div>
                <div class="trim-group">
                    <label>End (sec)</label>
                    <input type="number" class="trim-input" min="0" step="0.1" value="${clip.trimEnd}" placeholder="End" onchange="updateTrim('${clip.id}', 'end', this.value)">
                </div>
            </div>

            <button class="btn icon-btn remove" onclick="removeClip('${clip.id}')" title="Remove">✕</button>
        `;

        clipQueue.appendChild(item);
    });
}

// Expose functions to global scope for inline handlers
window.moveClip = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex >= 0 && newIndex < clips.length) {
        // Swap elements
        const temp = clips[index];
        clips[index] = clips[newIndex];
        clips[newIndex] = temp;
        renderQueue();
    }
};

window.updateTrim = (id, type, value) => {
    const clip = clips.find(c => c.id === id);
    if (clip) {
        if (type === 'start') {
            clip.trimStart = value ? parseFloat(value) : 0;
        } else {
            clip.trimEnd = value ? parseFloat(value) : '';
        }
    }
};

window.removeClip = (id) => {
    clips = clips.filter(c => c.id !== id);
    renderQueue();
};

// Initialize FFmpeg
async function initFFmpeg() {
    if (ffmpeg) return ffmpeg;

    // The CDN script tags give us FFmpegWASM
    const { FFmpeg } = FFmpegWASM;
    ffmpeg = new FFmpeg();

    // Log handler
    ffmpeg.on('log', ({ message }) => {
        console.log('[FFmpeg]', message);
    });

    // Progress handler
    ffmpeg.on('progress', ({ progress, time }) => {
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        if (progressFill && progressText) {
            const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
            progressFill.style.width = `${percent}%`;
            progressText.innerText = `Processing... ${percent}%`;
        }
    });

    console.log('Loading FFmpeg core...');
    // We explicitly set the core URLs to ensure they load from the same CDN version
    await ffmpeg.load({
        coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
        wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
    });
    console.log('FFmpeg loaded successfully');
    return ffmpeg;
}

// Helper to read file to Unit8Array
async function readFileAsUint8Array(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result));
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

async function processClips() {
    if (clips.length === 0) return;

    try {
        stitchBtn.disabled = true;
        const progressContainer = document.getElementById('progress-container');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');

        progressContainer.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.innerText = 'Initializing FFmpeg...';

        await initFFmpeg();
        const { fetchFile } = FFmpegUtil;

        progressText.innerText = 'Writing files to memory...';

        const inputArgs = [];
        let filterComplex = '';

        // Write each file to FFmpeg FS and build inputs/filter
        for (let i = 0; i < clips.length; i++) {
            const clip = clips[i];
            const fileName = `input_${i}.mp4`;

            // Read file and write to WASM FS
            const fileData = await fetchFile(clip.file);
            await ffmpeg.writeFile(fileName, fileData);

            // Build input arguments
            inputArgs.push('-i', fileName);

            // Build filter string
            // Syntax: [0:v]trim=start=X:end=Y,setpts=PTS-STARTPTS[v0];
            //         [0:a]atrim=start=X:end=Y,asetpts=PTS-STARTPTS[a0];
            const startStr = clip.trimStart > 0 ? `start=${clip.trimStart}` : '';
            const endStr = clip.trimEnd ? `end=${clip.trimEnd}` : '';

            let trimParams = [];
            if (startStr) trimParams.push(startStr);
            if (endStr) trimParams.push(endStr);

            const vTrimArg = trimParams.length > 0 ? `trim=${trimParams.join(':')},` : '';
            const aTrimArg = trimParams.length > 0 ? `atrim=${trimParams.join(':')},` : '';

            filterComplex += `[${i}:v]${vTrimArg}setpts=PTS-STARTPTS[v${i}];`;
            filterComplex += `[${i}:a]${aTrimArg}asetpts=PTS-STARTPTS[a${i}];`;
        }

        // Build the concat part of filter_complex
        // [v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]
        let concatStreams = '';
        for (let i = 0; i < clips.length; i++) {
            concatStreams += `[v${i}][a${i}]`;
        }
        filterComplex += `${concatStreams}concat=n=${clips.length}:v=1:a=1[outv][outa]`;

        const outputArgs = [
            '-filter_complex', filterComplex,
            '-map', '[outv]',
            '-map', '[outa]',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-c:a', 'aac',
            'output.mp4'
        ];

        const finalCommand = [...inputArgs, ...outputArgs];
        console.log("Executing FFmpeg command:", finalCommand);
        progressText.innerText = 'Processing video... (this may take a while)';

        // Execute command
        await ffmpeg.exec(finalCommand);

        progressText.innerText = 'Finalizing...';

        // Read the result
        const outputData = await ffmpeg.readFile('output.mp4');
        const blob = new Blob([outputData.buffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);

        // Display result
        const resultContainer = document.getElementById('result-container');
        const previewPlayer = document.getElementById('preview-player');
        const downloadBtn = document.getElementById('download-btn');

        previewPlayer.src = url;
        downloadBtn.href = url;

        progressContainer.style.display = 'none';
        resultContainer.style.display = 'block';

        // Scroll to result
        resultContainer.scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        console.error("FFmpeg error:", error);
        alert("Error during processing: " + error.message);
    } finally {
        stitchBtn.disabled = false;

        // Clean up virtual file system
        if (ffmpeg) {
            try {
                for (let i = 0; i < clips.length; i++) {
                    await ffmpeg.deleteFile(`input_${i}.mp4`).catch(() => {});
                }
                await ffmpeg.deleteFile('output.mp4').catch(() => {});
            } catch (e) {
                console.error("Cleanup error:", e);
            }
        }
    }
}

// Start
init();