import { Raf } from "@/lib/subs";

// Flag to enable/disable all logging and sampling
export const ENABLE_TICK_LOGGING = true;

// Check if TICK_FIRST_HIT exists (set in <head> before scripts load)
const tickFirstHit =
  typeof window !== "undefined" && (window as any).TICK_FIRST_HIT
    ? (window as any).TICK_FIRST_HIT
    : null;

// Capture the exact time when this JS file started executing
// This represents the time elapsed since page navigation started
const jsLoadDelay = performance.now();

// Calculate script load/evaluation time if TICK_FIRST_HIT exists
// Both tickFirstHit and jsLoadDelay are relative to performance.timeOrigin
const scriptLoadTime = tickFirstHit ? jsLoadDelay - tickFirstHit : null;

// Get the absolute time when page navigation started (for reference)
const pageLoadTime =
  performance.timeOrigin ||
  (performance.timing && performance.timing.navigationStart
    ? performance.timing.navigationStart
    : Date.now());

const startTime = performance.now();
let previousTime = startTime;
let isFirstCall = true;

// Track DOM ready time
let domReadyTime: number | null = null;
let firstRenderTime: number | null = null;

// Store event handlers for cleanup
const handleDOMContentLoaded = () => {
  domReadyTime = performance.now();
};

// Listen for DOM ready
if (typeof document !== "undefined") {
  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    // DOM already ready
    domReadyTime = performance.now();
  } else {
    document.addEventListener("DOMContentLoaded", handleDOMContentLoaded);
  }

  // Track first render (FCP)
  if (ENABLE_TICK_LOGGING && "PerformanceObserver" in window) {
    try {
      const paintObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const paintEntry = entry as PerformancePaintTiming;
          if (
            paintEntry.name === "first-contentful-paint" &&
            !firstRenderTime
          ) {
            firstRenderTime = paintEntry.startTime;
          }
        }
      });
      paintObserver.observe({ entryTypes: ["paint"] });
    } catch (e) {
      // PerformanceObserver not supported
    }
  }
}

// Async processing queue for metrics
const metricsUpdateQueue: Array<() => Promise<void>> = [];
let isProcessingQueue = false;

// Helper to schedule async work using requestIdleCallback or setTimeout fallback
function scheduleAsyncWork(callback: () => void, urgent = false): void {
  if (urgent) {
    // Use microtask for urgent work
    Promise.resolve().then(callback);
  } else if (typeof requestIdleCallback !== "undefined") {
    // Use requestIdleCallback when browser is idle
    requestIdleCallback(callback, { timeout: 2000 });
  } else {
    // Fallback to setTimeout
    setTimeout(callback, 0);
  }
}

// Worker for heavy calculations (TBT)
let webVitalsWorker: Worker | null = null;
const longTaskDurations: number[] = [];

async function initWorker(): Promise<Worker | null> {
  if (typeof Worker === "undefined") return null;

  try {
    // Create worker from inline code
    const workerCode = `
      function calculateTBT(longTaskDurations) {
        return longTaskDurations
          .filter((duration) => duration > 50)
          .reduce((sum, duration) => sum + (duration - 50), 0);
      }
      
      self.addEventListener('message', (e) => {
        const { type, data } = e.data;
        if (type === 'CALCULATE_TBT') {
          const tbt = calculateTBT(data);
          self.postMessage({ type: 'TBT_CALCULATED', data: tbt });
        }
      });
    `;

    const blob = new Blob([workerCode], { type: "application/javascript" });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    worker.onmessage = (e) => {
      const { type, data } = e.data;
      if (type === "TBT_CALCULATED") {
        webVitals.tbt = data;
      }
    };

    return worker;
  } catch (error) {
    return null;
  }
}

// Initialize worker asynchronously (non-blocking)
initWorker().then((worker) => {
  webVitalsWorker = worker;
});

// Lighthouse/Web Vitals metrics storage
interface WebVitals {
  fcp: number | null; // First Contentful Paint
  lcp: number | null; // Largest Contentful Paint
  fid: number | null; // First Input Delay
  cls: number; // Cumulative Layout Shift (always starts at 0)
  tbt: number; // Total Blocking Time
  tti: number | null; // Time to Interactive
  fmp: number | null; // First Meaningful Paint
}

const webVitals: WebVitals = {
  fcp: null,
  lcp: null,
  fid: null,
  cls: 0,
  tbt: 0,
  tti: null,
  fmp: null,
};

// Helper to get Lighthouse score color (green/yellow/red)
function getScoreColor(
  value: number,
  thresholds: { good: number; poor: number }
): string {
  if (value <= thresholds.good) return "#10b981"; // green
  if (value <= thresholds.poor) return "#f59e0b"; // yellow
  return "#ef4444"; // red
}

// Helper to get Lighthouse rating
function getRating(
  value: number,
  thresholds: { good: number; poor: number }
): string {
  if (value <= thresholds.good) return "good";
  if (value <= thresholds.poor) return "needs-improvement";
  return "poor";
}

// Capture FCP (First Contentful Paint)
if (ENABLE_TICK_LOGGING) {
  try {
    const paintEntries = performance.getEntriesByType(
      "paint"
    ) as PerformancePaintTiming[];
    paintEntries.forEach((entry) => {
      if (entry.name === "first-contentful-paint") {
        webVitals.fcp = entry.startTime;
      }
    });
  } catch (e) {
    // Paint Timing API not supported
  }
}

// Capture FMP (First Meaningful Paint) - fallback estimation
if (ENABLE_TICK_LOGGING) {
  try {
    const paintEntries = performance.getEntriesByType(
      "paint"
    ) as PerformancePaintTiming[];
    paintEntries.forEach((entry) => {
      if (entry.name === "first-paint") {
        webVitals.fmp = entry.startTime;
      }
    });
  } catch (e) {
    // Paint Timing API not supported
  }
}

// Capture LCP (Largest Contentful Paint) using Performance Observer
let lcpObserver: PerformanceObserver | null = null;
if (
  ENABLE_TICK_LOGGING &&
  "PerformanceObserver" in window &&
  "observe" in PerformanceObserver.prototype
) {
  try {
    lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1] as any;
      if (lastEntry && lastEntry.renderTime) {
        webVitals.lcp = lastEntry.renderTime || lastEntry.loadTime;
      }
    });
    lcpObserver.observe({ entryTypes: ["largest-contentful-paint"] });
  } catch (e) {
    // LCP API not supported
  }
}

// Capture CLS (Cumulative Layout Shift) using Performance Observer
let clsObserver: PerformanceObserver | null = null;
if (ENABLE_TICK_LOGGING && "PerformanceObserver" in window) {
  try {
    clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const layoutEntry = entry as any;
        if (!layoutEntry.hadRecentInput && layoutEntry.value) {
          webVitals.cls += layoutEntry.value;
        }
      }
    });
    clsObserver.observe({ entryTypes: ["layout-shift"] });
  } catch (e) {
    // Layout Instability API not supported
  }
}

// Capture FID (First Input Delay) using Performance Observer
let fidObserver: PerformanceObserver | null = null;
if (ENABLE_TICK_LOGGING && "PerformanceObserver" in window) {
  try {
    fidObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const fidEntry = entry as PerformanceEventTiming;
        if (fidEntry.processingStart && fidEntry.startTime) {
          webVitals.fid = fidEntry.processingStart - fidEntry.startTime;
          fidObserver?.disconnect(); // Only capture first input
        }
      }
    });
    fidObserver.observe({ entryTypes: ["first-input"] });
  } catch (e) {
    // First Input API not supported
  }
}

// Calculate TBT (Total Blocking Time) from long tasks
let longTaskObserver: PerformanceObserver | null = null;
const longTasks: number[] = [];
if (ENABLE_TICK_LOGGING && "PerformanceObserver" in window) {
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const longTask = entry as any;
        // Tasks over 50ms contribute to TBT (blocking time = duration - 50ms)
        if (longTask.duration > 50) {
          const blockingTime = longTask.duration - 50;
          longTasks.push(blockingTime);
          webVitals.tbt = longTasks.reduce((sum, t) => sum + t, 0);
        }
      }
    });
    longTaskObserver.observe({ entryTypes: ["longtask"] });
  } catch (e) {
    // Long Task API not supported
  }
}

// Estimate TTI (Time to Interactive) from navigation timing
if (ENABLE_TICK_LOGGING) {
  try {
    if (performance.timing) {
      const timing = performance.timing;
      const domInteractive = timing.domInteractive - timing.navigationStart;
      const domComplete =
        timing.domContentLoadedEventEnd - timing.navigationStart;
      // TTI is typically around DOMInteractive + 5 seconds (simplified)
      webVitals.tti =
        domInteractive > 0
          ? domInteractive
          : domComplete > 0
          ? domComplete
          : null;
    } else if (performance.getEntriesByType) {
      const navEntries = performance.getEntriesByType(
        "navigation"
      ) as PerformanceNavigationTiming[];
      if (navEntries.length > 0) {
        const nav = navEntries[0];
        webVitals.tti =
          nav.domInteractive > 0
            ? nav.domInteractive
            : nav.domContentLoadedEventEnd;
      }
    }
  } catch (e) {
    // Navigation Timing API not available
  }
}

// Animation Performance Metrics
interface AnimationMetrics {
  fps: number; // Current frames per second
  avgFps: number; // Average FPS over tracking period
  minFps: number; // Minimum FPS observed
  maxFps: number; // Maximum FPS observed
  frameTime: number; // Current frame time in ms
  avgFrameTime: number; // Average frame time in ms
  minFrameTime: number; // Minimum frame time in ms
  maxFrameTime: number; // Maximum frame time in ms
  droppedFrames: number; // Count of frames exceeding budget
  frameBudgetCompliance: number; // Percentage of frames within budget (0-100)
  smoothnessScore: number; // Animation smoothness score (0-100)
  memoryUsed: number | null; // Heap size in MB (if available)
  memoryTotal: number | null; // Total heap size in MB (if available)
  totalFrames: number; // Total frames tracked
  longFrames: number; // Frames exceeding 50ms
}

// Frame timing constants
const FRAME_BUDGET_60FPS = 16.67; // ms per frame for 60fps
const FRAME_BUDGET_30FPS = 33.33; // ms per frame for 30fps
const TARGET_FPS = 60;
const FRAME_BUDGET = FRAME_BUDGET_60FPS;
const LONG_FRAME_THRESHOLD = 50; // ms

// Frame tracking state
let animationMetrics: AnimationMetrics = {
  fps: 0,
  avgFps: 0,
  minFps: Infinity,
  maxFps: 0,
  frameTime: 0,
  avgFrameTime: 0,
  minFrameTime: Infinity,
  maxFrameTime: 0,
  droppedFrames: 0,
  frameBudgetCompliance: 100,
  smoothnessScore: 100,
  memoryUsed: null,
  memoryTotal: null,
  totalFrames: 0,
  longFrames: 0,
};

// Frame time history for calculations (rolling window)
const frameTimeHistory: number[] = [];
const MAX_HISTORY_SIZE = 120; // Track last ~2 seconds at 60fps

let rafUnsubscribe: (() => void) | null = null;
let frameTrackingActive = false;

/**
 * Frame Drop Detection and Attribution
 *
 * This system detects dropped frames and identifies which function calls caused them.
 *
 * Usage:
 *
 * 1. Enable frame drop detection:
 *    tick.enableFrameDropDetection(true);
 *
 * 2. Enable function instrumentation (optional, for automatic tracking):
 *    tick.enableFunctionInstrumentation(true);
 *
 * 3. Instrument specific functions manually:
 *    const myFunction = tick.instrumentFunction(originalFunction, "myFunction");
 *
 * 4. Instrument all methods on an object:
 *    tick.instrumentObjectMethods(myObject, "MyObject");
 *
 * 5. When a frame drop is detected, it will automatically:
 *    - Log to console with details
 *    - Show slow functions from Performance API marks/measures
 *    - Show slow functions from instrumented functions
 *
 * 6. Get frame drop history:
 *    const drops = tick.getFrameDropHistory();
 *
 * 7. Get instrumented function stats:
 *    const stats = tick.getInstrumentedFunctionStats();
 *
 * The system uses:
 * - requestAnimationFrame timing to detect actual frame boundaries
 * - Performance.mark() and Performance.measure() for function timing
 * - Stack traces to identify call sites
 */
interface FrameDropInfo {
  frameTime: number;
  timestamp: number;
  frameNumber: number;
  slowFunctions: Array<{
    name: string;
    duration: number;
    stack?: string;
  }>;
  performanceMarks: Array<{
    name: string;
    startTime: number;
    duration: number;
  }>;
  stackTrace?: string;
}

const frameDropHistory: FrameDropInfo[] = [];
const MAX_FRAME_DROP_HISTORY = 50; // Keep last 50 dropped frames

// Track frame boundaries using requestAnimationFrame
let rafFrameStart: number | null = null;
let rafFrameNumber = 0;
let frameDropDetectionEnabled = false;
let functionInstrumentationEnabled = false;

// Map to track instrumented functions
const instrumentedFunctions = new Map<
  string,
  {
    original: Function;
    callCount: number;
    totalTime: number;
    maxTime: number;
    minTime: number;
  }
>();

// Performance marks for current frame
let currentFrameMarks: Array<{ name: string; startTime: number }> = [];

// Memory tracking
function updateMemoryMetrics() {
  if (
    "memory" in performance &&
    typeof (performance as any).memory !== "undefined"
  ) {
    const memory = (performance as any).memory;
    animationMetrics.memoryUsed = memory.usedJSHeapSize / 1048576; // Convert to MB
    animationMetrics.memoryTotal = memory.totalJSHeapSize / 1048576;
  }
}

// Frame drop detection using requestAnimationFrame timing
function detectFrameDrops() {
  if (!frameDropDetectionEnabled) return;

  const now = performance.now();

  if (rafFrameStart === null) {
    rafFrameStart = now;
    rafFrameNumber = 0;
    return;
  }

  const frameTime = now - rafFrameStart;
  rafFrameNumber++;

  // Detect dropped frames (frame time > 1.5x budget indicates a dropped frame)
  const droppedFrameThreshold = FRAME_BUDGET * 1.5;

  if (frameTime > droppedFrameThreshold) {
    analyzeFrameDrop(frameTime, rafFrameNumber);
  }

  rafFrameStart = now;
}

// Analyze a dropped frame and identify slow functions
function analyzeFrameDrop(frameTime: number, frameNumber: number) {
  const dropInfo: FrameDropInfo = {
    frameTime,
    timestamp: performance.now(),
    frameNumber,
    slowFunctions: [],
    performanceMarks: [],
  };

  // Get performance marks from the current frame
  try {
    const marks = performance.getEntriesByType("mark") as PerformanceMark[];
    const measures = performance.getEntriesByType(
      "measure"
    ) as PerformanceMeasure[];

    // Filter marks/measures from recent timeframe (last 100ms)
    const recentThreshold = performance.now() - 100;
    const recentMarks = marks.filter((m) => m.startTime >= recentThreshold);
    const recentMeasures = measures.filter(
      (m) => m.startTime >= recentThreshold
    );

    // Sort measures by duration (longest first)
    recentMeasures.sort((a, b) => b.duration - a.duration);

    // Get top slow functions
    dropInfo.performanceMarks = recentMeasures.slice(0, 10).map((m) => ({
      name: m.name,
      startTime: m.startTime,
      duration: m.duration,
    }));

    // Get slow functions from instrumented functions
    if (functionInstrumentationEnabled) {
      const slowFunctions = Array.from(instrumentedFunctions.entries())
        .map(([name, stats]) => ({
          name,
          avgTime: stats.totalTime / Math.max(stats.callCount, 1),
          maxTime: stats.maxTime,
          callCount: stats.callCount,
        }))
        .filter((f) => f.maxTime > 5) // Only include functions that took > 5ms
        .sort((a, b) => b.maxTime - a.maxTime)
        .slice(0, 5);

      dropInfo.slowFunctions = slowFunctions.map((f) => ({
        name: f.name,
        duration: f.maxTime,
      }));
    }

    // Capture stack trace if available
    try {
      throw new Error();
    } catch (e: any) {
      if (e.stack) {
        dropInfo.stackTrace = e.stack;
      }
    }
  } catch (e) {
    // Performance API might not be fully available
  }

  // Add to history
  frameDropHistory.push(dropInfo);
  if (frameDropHistory.length > MAX_FRAME_DROP_HISTORY) {
    frameDropHistory.shift();
  }

  // Log the frame drop with details
  if (ENABLE_TICK_LOGGING && frameDropDetectionEnabled) {
    console.warn(
      `%c⚠️ Frame Drop Detected%c Frame #${frameNumber} took ${frameTime.toFixed(
        2
      )}ms (budget: ${FRAME_BUDGET.toFixed(2)}ms)`,
      "background: #ef4444; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;",
      "color: #ef4444; font-weight: bold; margin-left: 8px;"
    );

    if (dropInfo.performanceMarks.length > 0) {
      console.group("Slow Functions (Performance Marks):");
      dropInfo.performanceMarks.forEach((mark, i) => {
        const color =
          mark.duration > 16
            ? "#ef4444"
            : mark.duration > 8
            ? "#f59e0b"
            : "#6b7280";
        console.log(
          `%c${i + 1}. ${mark.name}%c ${mark.duration.toFixed(2)}ms`,
          `color: ${color}; font-weight: bold;`,
          `color: ${color};`
        );
      });
      console.groupEnd();
    }

    if (dropInfo.slowFunctions.length > 0) {
      console.group("Slow Functions (Instrumented):");
      dropInfo.slowFunctions.forEach((fn, i) => {
        const color =
          fn.duration > 16
            ? "#ef4444"
            : fn.duration > 8
            ? "#f59e0b"
            : "#6b7280";
        console.log(
          `%c${i + 1}. ${fn.name}%c ${fn.duration.toFixed(2)}ms`,
          `color: ${color}; font-weight: bold;`,
          `color: ${color};`
        );
      });
      console.groupEnd();
    }
  }
}

// Instrument a function to track its performance
function instrumentFunction<T extends (...args: any[]) => any>(
  fn: T,
  name: string
): T {
  if (!functionInstrumentationEnabled) return fn;

  const stats = {
    original: fn,
    callCount: 0,
    totalTime: 0,
    maxTime: 0,
    minTime: Infinity,
  };

  instrumentedFunctions.set(name, stats);

  return ((...args: any[]) => {
    const start = performance.now();
    const markName = `fn:${name}`;

    try {
      performance.mark(`${markName}:start`);
      const result = fn(...args);
      performance.mark(`${markName}:end`);
      performance.measure(markName, `${markName}:start`, `${markName}:end`);

      const duration = performance.now() - start;

      stats.callCount++;
      stats.totalTime += duration;
      stats.maxTime = Math.max(stats.maxTime, duration);
      stats.minTime = Math.min(stats.minTime, duration);

      // Clean up old marks to avoid memory issues
      try {
        performance.clearMarks(`${markName}:start`);
        performance.clearMarks(`${markName}:end`);
        performance.clearMeasures(markName);
      } catch (e) {
        // Ignore cleanup errors
      }

      return result;
    } catch (error) {
      const duration = performance.now() - start;
      stats.callCount++;
      stats.totalTime += duration;
      throw error;
    }
  }) as T;
}

// Auto-instrument methods on an object
function instrumentObjectMethods(obj: any, prefix: string = "") {
  if (!functionInstrumentationEnabled) return;

  Object.getOwnPropertyNames(Object.getPrototypeOf(obj)).forEach((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(obj),
      name
    );
    if (
      descriptor &&
      typeof descriptor.value === "function" &&
      name !== "constructor"
    ) {
      const original = obj[name];
      obj[name] = instrumentFunction(original.bind(obj), `${prefix}.${name}`);
    }
  });
}

// FPS Display UI
let fpsElement: HTMLDivElement | null = null;
let fpsDisplayVisible = false;
const FPS_DISPLAY_STORAGE_KEY = "fps-display-visible";
let fpsFrameCount = 0;
let fpsLastTime = 0;

function createFpsDisplay(): HTMLDivElement {
  const div = document.createElement("div");
  div.textContent = "FPS: --";
  div.style.position = "fixed";
  div.style.bottom = "0";
  div.style.left = "0";
  div.style.backgroundColor = "black";
  div.style.color = "white";
  div.style.padding = "8px 12px";
  div.style.fontFamily = "monospace";
  div.style.fontSize = "8px";
  div.style.zIndex = "999999";
  div.style.pointerEvents = "none";
  div.style.display = fpsDisplayVisible ? "block" : "none";
  document.body.appendChild(div);
  return div;
}

function loadFpsDisplayState() {
  const saved = localStorage.getItem(FPS_DISPLAY_STORAGE_KEY);
  if (saved !== null) {
    fpsDisplayVisible = saved === "true";
  }
}

function saveFpsDisplayState() {
  localStorage.setItem(FPS_DISPLAY_STORAGE_KEY, String(fpsDisplayVisible));
}

function toggleFpsDisplay() {
  fpsDisplayVisible = !fpsDisplayVisible;
  if (fpsElement) {
    fpsElement.style.display = fpsDisplayVisible ? "block" : "none";
  }
  saveFpsDisplayState();
}

function updateFpsDisplay() {
  if (!fpsElement || !fpsDisplayVisible) return;

  // Calculate FPS using frame counting method (like the old Raf service)
  fpsFrameCount++;
  const currentTime = performance.now();

  if (fpsLastTime === 0) {
    fpsLastTime = currentTime;
    return;
  }

  const elapsedTime = currentTime - fpsLastTime;

  if (fpsFrameCount >= 10 && elapsedTime > 0) {
    const fps = Math.round((1000 * fpsFrameCount) / elapsedTime);
    if (fps > 0) {
      fpsElement.textContent = `FPS: ${fps}`;
    }
    fpsFrameCount = 0;
    fpsLastTime = currentTime;
  }
}

// Initialize FPS display
// Store keyboard event handler for cleanup
const handleFpsToggleKeydown = (e: KeyboardEvent) => {
  if (e.shiftKey && (e.key === "F" || e.key === "f")) {
    e.preventDefault();
    toggleFpsDisplay();
  }
};

function initFpsDisplay() {
  if (typeof document === "undefined" || !document.body) return;

  loadFpsDisplayState();
  fpsElement = createFpsDisplay();

  // Keyboard shortcut to toggle FPS display (Shift+F)
  window.addEventListener("keydown", handleFpsToggleKeydown);
}

function cleanupFpsDisplay() {
  if (!ENABLE_TICK_LOGGING) return;
  stopFrameTracking();
  if (fpsElement && fpsElement.parentNode) {
    fpsElement.parentNode.removeChild(fpsElement);
    fpsElement = null;
  }
  fpsFrameCount = 0;
  fpsLastTime = 0;
}

function restoreFpsDisplay() {
  if (typeof document === "undefined" || !document.body) return;
  if (!ENABLE_TICK_LOGGING) return;

  // Check if FPS element exists and is still in the DOM
  if (!fpsElement || !fpsElement.parentNode) {
    // Recreate the FPS display if it was removed (e.g., during page transitions)
    loadFpsDisplayState();
    fpsElement = createFpsDisplay();

    // Reset FPS tracking counters so calculation starts fresh
    // Initialize to current time so it can start calculating immediately
    fpsLastTime = performance.now();
    fpsFrameCount = 0;
  }

  // Restart frame tracking if it was stopped during page transition cleanup
  if (!frameTrackingActive) {
    startFrameTracking();
  }
}

// Initialize when DOM is ready
if (ENABLE_TICK_LOGGING && typeof document !== "undefined") {
  if (document.body) {
    initFpsDisplay();
  } else {
    document.addEventListener("DOMContentLoaded", initFpsDisplay);
  }
}

// Start frame tracking using Raf subscription
function startFrameTracking() {
  if (frameTrackingActive) return;
  frameTrackingActive = true;

  // Initialize FPS display timing
  fpsLastTime = performance.now();
  fpsFrameCount = 0;

  rafUnsubscribe = Raf.add(({ deltaTime }) => {
    // Detect frame drops using GSAP ticker timing (no separate RAF loop needed)
    if (frameDropDetectionEnabled) {
      detectFrameDrops();
    }
    // Convert deltaTime from seconds to milliseconds
    const frameTime = deltaTime * 1000;

    // Update frame time metrics
    animationMetrics.frameTime = frameTime;
    animationMetrics.fps = frameTime > 0 ? Math.round(1000 / frameTime) : 0;

    // Update min/max
    animationMetrics.minFrameTime = Math.min(
      animationMetrics.minFrameTime,
      frameTime
    );
    animationMetrics.maxFrameTime = Math.max(
      animationMetrics.maxFrameTime,
      frameTime
    );
    animationMetrics.minFps = Math.min(
      animationMetrics.minFps,
      animationMetrics.fps
    );
    animationMetrics.maxFps = Math.max(
      animationMetrics.maxFps,
      animationMetrics.fps
    );

    // Track dropped frames (exceeding budget)
    if (frameTime > FRAME_BUDGET) {
      animationMetrics.droppedFrames++;
    }

    // Track long frames
    if (frameTime > LONG_FRAME_THRESHOLD) {
      animationMetrics.longFrames++;
    }

    // Add to history (rolling window)
    frameTimeHistory.push(frameTime);
    if (frameTimeHistory.length > MAX_HISTORY_SIZE) {
      frameTimeHistory.shift();
    }

    // Calculate averages from history
    if (frameTimeHistory.length > 0) {
      const sum = frameTimeHistory.reduce((a, b) => a + b, 0);
      animationMetrics.avgFrameTime = sum / frameTimeHistory.length;
      animationMetrics.avgFps = Math.round(
        1000 / animationMetrics.avgFrameTime
      );
    }

    // Calculate frame budget compliance
    const framesInBudget = frameTimeHistory.filter(
      (ft) => ft <= FRAME_BUDGET
    ).length;
    animationMetrics.frameBudgetCompliance =
      (framesInBudget / frameTimeHistory.length) * 100;

    // Calculate smoothness score based on frame time variance
    if (frameTimeHistory.length >= 30) {
      const variance =
        frameTimeHistory.reduce((acc, ft) => {
          const diff = ft - animationMetrics.avgFrameTime;
          return acc + diff * diff;
        }, 0) / frameTimeHistory.length;
      const stdDev = Math.sqrt(variance);
      // Smoothness score: lower variance = higher score
      // Good: stdDev < 2ms, Poor: stdDev > 5ms
      animationMetrics.smoothnessScore = Math.max(
        0,
        Math.min(100, 100 - (stdDev / 5) * 50)
      );
    }

    animationMetrics.totalFrames++;

    // Update FPS display (uses frame counting method)
    updateFpsDisplay();

    // Update memory metrics periodically (every 60 frames ~1 second)
    if (animationMetrics.totalFrames % 60 === 0) {
      updateMemoryMetrics();
    }
  });
}

// Stop frame tracking
function stopFrameTracking() {
  if (rafUnsubscribe !== null) {
    rafUnsubscribe();
    rafUnsubscribe = null;
  }
  frameTrackingActive = false;
  rafFrameStart = null;
}

// Note: Animation Frame Timing API ('animation-frame' entry type) is not widely supported
// We use RAF tracking instead (see startFrameTracking function above) which is more reliable

// Start tracking automatically
if (ENABLE_TICK_LOGGING) {
  startFrameTracking();
}

// Reset animation metrics
function resetAnimationMetrics() {
  animationMetrics = {
    fps: 0,
    avgFps: 0,
    minFps: Infinity,
    maxFps: 0,
    frameTime: 0,
    avgFrameTime: 0,
    minFrameTime: Infinity,
    maxFrameTime: 0,
    droppedFrames: 0,
    frameBudgetCompliance: 100,
    smoothnessScore: 100,
    memoryUsed: null,
    memoryTotal: null,
    totalFrames: 0,
    longFrames: 0,
  };
  frameTimeHistory.length = 0;
  updateMemoryMetrics();
}

// Display animation metrics
function displayAnimationMetrics() {
  if (!ENABLE_TICK_LOGGING) return;

  const m = animationMetrics;

  // FPS
  const fpsColor = getScoreColor(m.avgFps, { good: 55, poor: 30 });
  const fpsRating = getRating(m.avgFps, { good: 55, poor: 30 });
  console.log(
    `%cFPS%c ${m.avgFps} (${m.fps} current, ${m.minFps}-${m.maxFps} range) %c(${fpsRating})`,
    "background: #8b5cf6; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 0.85em;",
    `color: ${fpsColor}; font-weight: bold; font-size: 0.85em;`,
    `color: ${fpsColor}; font-size: 0.85em;`
  );

  // Frame Time
  const frameTimeColor = getScoreColor(m.avgFrameTime, {
    good: 20,
    poor: 33.33,
  });
  const frameTimeRating = getRating(m.avgFrameTime, {
    good: 20,
    poor: 33.33,
  });
  console.log(
    `%cFrame Time%c ${m.avgFrameTime.toFixed(2)}ms (${m.minFrameTime.toFixed(
      2
    )}-${m.maxFrameTime.toFixed(2)}ms) %c(${frameTimeRating})`,
    "background: #8b5cf6; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 0.85em;",
    `color: ${frameTimeColor}; font-weight: bold; font-size: 0.85em;`,
    `color: ${frameTimeColor}; font-size: 0.85em;`
  );

  // Dropped Frames
  const droppedFramesPercent =
    m.totalFrames > 0 ? (m.droppedFrames / m.totalFrames) * 100 : 0;
  const droppedColor = getScoreColor(droppedFramesPercent, {
    good: 5,
    poor: 20,
  });
  const droppedRating = getRating(droppedFramesPercent, {
    good: 5,
    poor: 20,
  });
  console.log(
    `%cDropped Frames%c ${m.droppedFrames} (${droppedFramesPercent.toFixed(
      1
    )}%) %c(${droppedRating})`,
    "background: #8b5cf6; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 0.85em;",
    `color: ${droppedColor}; font-weight: bold; font-size: 0.85em;`,
    `color: ${droppedColor}; font-size: 0.85em;`
  );

  // Frame Budget Compliance
  const complianceColor = getScoreColor(100 - m.frameBudgetCompliance, {
    good: 5,
    poor: 20,
  });
  const complianceRating = getRating(100 - m.frameBudgetCompliance, {
    good: 5,
    poor: 20,
  });
  console.log(
    `%cBudget Compliance%c ${m.frameBudgetCompliance.toFixed(
      1
    )}% %c(${complianceRating})`,
    "background: #8b5cf6; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 0.85em;",
    `color: ${complianceColor}; font-weight: bold; font-size: 0.85em;`,
    `color: ${complianceColor}; font-size: 0.85em;`
  );

  // Smoothness Score
  const smoothnessColor = getScoreColor(100 - m.smoothnessScore, {
    good: 10,
    poor: 30,
  });
  const smoothnessRating = getRating(100 - m.smoothnessScore, {
    good: 10,
    poor: 30,
  });
  console.log(
    `%cSmoothness%c ${m.smoothnessScore.toFixed(
      1
    )}/100 %c(${smoothnessRating})`,
    "background: #8b5cf6; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 0.85em;",
    `color: ${smoothnessColor}; font-weight: bold; font-size: 0.85em;`,
    `color: ${smoothnessColor}; font-size: 0.85em;`
  );

  // Long Frames
  if (m.longFrames > 0) {
    const longFramesPercent =
      m.totalFrames > 0 ? (m.longFrames / m.totalFrames) * 100 : 0;
    const longFramesColor = getScoreColor(longFramesPercent, {
      good: 1,
      poor: 5,
    });
    const longFramesRating = getRating(longFramesPercent, {
      good: 1,
      poor: 5,
    });
    console.log(
      `%cLong Frames%c ${m.longFrames} (${longFramesPercent.toFixed(
        1
      )}%, >${LONG_FRAME_THRESHOLD}ms) %c(${longFramesRating})`,
      "background: #8b5cf6; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 0.85em;",
      `color: ${longFramesColor}; font-weight: bold; font-size: 0.85em;`,
      `color: ${longFramesColor}; font-size: 0.85em;`
    );
  }

  // Memory Usage
  if (m.memoryUsed !== null && m.memoryTotal !== null) {
    const memoryPercent = (m.memoryUsed / m.memoryTotal) * 100;
    const memoryColor = getScoreColor(memoryPercent, {
      good: 50,
      poor: 80,
    });
    console.log(
      `%cMemory%c ${m.memoryUsed.toFixed(1)}MB / ${m.memoryTotal.toFixed(
        1
      )}MB (${memoryPercent.toFixed(1)}%)`,
      "background: #8b5cf6; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 0.85em;",
      `color: ${memoryColor}; font-weight: bold; font-size: 0.85em;`
    );
  }

  // Total Frames
  console.log(
    `%cTotal Frames Tracked%c ${m.totalFrames}`,
    "background: #8b5cf6; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 0.85em;",
    "color: #6b7280; font-size: 0.85em;"
  );
}

// Display Lighthouse-like metrics
function displayWebVitals() {
  if (!ENABLE_TICK_LOGGING) return;

  const fcp = webVitals.fcp;
  const lcp = webVitals.lcp;
  const fid = webVitals.fid;
  const cls = webVitals.cls;
  const tbt = webVitals.tbt;

  // FCP
  if (fcp !== null) {
    const fcpColor = getScoreColor(fcp, { good: 1800, poor: 3000 });
    const fcpRating = getRating(fcp, { good: 1800, poor: 3000 });
    console.log(
      `%cFCP%c ${fcp.toFixed(0)}ms %c(${fcpRating})`,
      "background: #6366f1; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 0.85em;",
      `color: ${fcpColor}; font-weight: bold; font-size: 0.85em;`,
      `color: ${fcpColor}; font-size: 0.85em;`
    );
  }

  // LCP
  if (lcp !== null) {
    const lcpColor = getScoreColor(lcp, { good: 2500, poor: 4000 });
    const lcpRating = getRating(lcp, { good: 2500, poor: 4000 });
    console.log(
      `%cLCP%c ${lcp.toFixed(0)}ms %c(${lcpRating})`,
      "background: #6366f1; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 0.85em;",
      `color: ${lcpColor}; font-weight: bold; font-size: 0.85em;`,
      `color: ${lcpColor}; font-size: 0.85em;`
    );
  }

  // FID
  if (fid !== null) {
    const fidColor = getScoreColor(fid, { good: 100, poor: 300 });
    const fidRating = getRating(fid, { good: 100, poor: 300 });
    console.log(
      `%cFID%c ${fid.toFixed(2)}ms %c(${fidRating})`,
      "background: #6366f1; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 0.85em;",
      `color: ${fidColor}; font-weight: bold; font-size: 0.85em;`,
      `color: ${fidColor}; font-size: 0.85em;`
    );
  }

  // CLS
  const clsColor = getScoreColor(cls, { good: 0.1, poor: 0.25 });
  const clsRating = getRating(cls, { good: 0.1, poor: 0.25 });
  console.log(
    `%cCLS%c ${cls.toFixed(3)} %c(${clsRating})`,
    "background: #6366f1; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 0.85em;",
    `color: ${clsColor}; font-weight: bold; font-size: 0.85em;`,
    `color: ${clsColor}; font-size: 0.85em;`
  );

  // TBT
  if (tbt > 0) {
    const tbtColor = getScoreColor(tbt, { good: 200, poor: 600 });
    const tbtRating = getRating(tbt, { good: 200, poor: 600 });
    console.log(
      `%cTBT%c ${tbt.toFixed(0)}ms %c(${tbtRating})`,
      "background: #6366f1; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 0.85em;",
      `color: ${tbtColor}; font-weight: bold; font-size: 0.85em;`,
      `color: ${tbtColor}; font-size: 0.85em;`
    );
  }
}

const tick = {
  // Get the time it took for JS to load after page load
  getJsLoadDelay(): number {
    return jsLoadDelay;
  },

  // Get the time since page load (absolute time)
  getTimeSincePageLoad(): number {
    return performance.timeOrigin + performance.now() - pageLoadTime;
  },

  // Get all Web Vitals metrics (Lighthouse-like)
  getWebVitals(): WebVitals {
    return { ...webVitals };
  },

  // Display Web Vitals metrics in console
  showWebVitals() {
    displayWebVitals();
  },

  // Get all animation performance metrics
  getAnimationMetrics(): AnimationMetrics {
    return { ...animationMetrics };
  },

  // Display animation metrics in console
  showAnimationMetrics() {
    displayAnimationMetrics();
  },

  // Reset animation metrics (useful for testing different scenarios)
  resetAnimationMetrics() {
    resetAnimationMetrics();
  },

  // Start/stop frame tracking (for performance debugging)
  startFrameTracking() {
    startFrameTracking();
  },

  stopFrameTracking() {
    stopFrameTracking();
  },

  // Frame drop detection
  enableFrameDropDetection(enabled = true) {
    frameDropDetectionEnabled = enabled;
    if (enabled && !frameTrackingActive) {
      startFrameTracking();
    }
  },

  disableFrameDropDetection() {
    frameDropDetectionEnabled = false;
  },

  // Function instrumentation
  enableFunctionInstrumentation(enabled = true) {
    functionInstrumentationEnabled = enabled;
  },

  disableFunctionInstrumentation() {
    functionInstrumentationEnabled = false;
  },

  // Instrument a function to track its performance
  instrumentFunction<T extends (...args: any[]) => any>(
    fn: T,
    name: string
  ): T {
    return instrumentFunction(fn, name);
  },

  // Instrument all methods on an object
  instrumentObjectMethods(obj: any, prefix: string = "") {
    instrumentObjectMethods(obj, prefix);
  },

  // Get frame drop history
  getFrameDropHistory(): FrameDropInfo[] {
    return [...frameDropHistory];
  },

  // Get instrumented function stats
  getInstrumentedFunctionStats() {
    return Array.from(instrumentedFunctions.entries()).map(([name, stats]) => ({
      name,
      callCount: stats.callCount,
      avgTime: stats.totalTime / Math.max(stats.callCount, 1),
      maxTime: stats.maxTime,
      minTime: stats.minTime === Infinity ? 0 : stats.minTime,
      totalTime: stats.totalTime,
    }));
  },

  // Clear frame drop history
  clearFrameDropHistory() {
    frameDropHistory.length = 0;
  },

  // Clear instrumented function stats
  clearInstrumentedFunctionStats() {
    instrumentedFunctions.clear();
  },

  // FPS Display control
  toggleFpsDisplay() {
    toggleFpsDisplay();
  },

  showFpsDisplay() {
    if (!fpsDisplayVisible) {
      toggleFpsDisplay();
    }
  },

  hideFpsDisplay() {
    if (fpsDisplayVisible) {
      toggleFpsDisplay();
    }
  },

  restoreFpsDisplay() {
    restoreFpsDisplay();
  },

  cleanupFpsDisplay() {
    cleanupFpsDisplay();
  },

  add(eventName: string, showVitals = false) {
    if (!ENABLE_TICK_LOGGING) return;

    const now = performance.now();
    const timeSinceStart = ((now - startTime) / 1000).toFixed(2);
    const timeSincePrevious = ((now - previousTime) / 1000).toFixed(2);

    if (isFirstCall) {
      // First event (start) - show timing metrics
      const jsLoadDelaySeconds = (jsLoadDelay / 1000).toFixed(2);

      // Build timing info lines (condensed format)
      const timingLines: string[] = [];
      timingLines.push(`js → ${jsLoadDelaySeconds}s`);

      // Only show script load time if TICK_FIRST_HIT exists
      if (scriptLoadTime !== null && scriptLoadTime > 0) {
        const scriptLoadSeconds = (scriptLoadTime / 1000).toFixed(2);
        timingLines.push(`eval → ${scriptLoadSeconds}s`);
      }

      // Show DOM ready time if available
      if (domReadyTime !== null) {
        const domReadySeconds = ((domReadyTime - startTime) / 1000).toFixed(2);
        timingLines.push(`DOM → ${domReadySeconds}s`);
      }

      // Show first render time if available
      if (firstRenderTime !== null) {
        const renderSeconds = (firstRenderTime / 1000).toFixed(2);
        timingLines.push(`render → ${renderSeconds}s`);
      } else if (webVitals.fcp !== null) {
        const fcpSeconds = (webVitals.fcp / 1000).toFixed(2);
        timingLines.push(`render → ${fcpSeconds}s`);
      }

      // Single log entry with newlines and smaller font for timing info
      console.log(
        `%c⏱%c${eventName}%c→ ${timeSinceStart}s%c\n  ${timingLines.join(
          "\n  "
        )}`,
        "background: #6366f1; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;",
        "background: #374151; color: #e5e7eb; padding: 2px 6px; border-radius: 3px; font-weight: 500;",
        "color: #10b981; font-weight: bold;",
        "color: #9ca3af; font-size: 0.85em; font-style: italic;"
      );

      // Show web vitals after a short delay to let metrics accumulate
      if (showVitals) {
        setTimeout(() => {
          displayWebVitals();
        }, 1000);
      }

      isFirstCall = false;
    } else {
      // Subsequent events
      console.log(
        `%c⏱%c${eventName}%c→ ${timeSinceStart}s%c (Δ ${timeSincePrevious}s)`,
        "background: #6366f1; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;",
        "background: #374151; color: #e5e7eb; padding: 2px 6px; border-radius: 3px; font-weight: 500;",
        "color: #10b981; font-weight: bold;",
        "color: #6b7280; font-size: 0.9em;"
      );

      if (showVitals) {
        displayWebVitals();
      }
    }

    previousTime = now;
  },

  // Cleanup performance observers and frame tracking
  cleanup() {
    lcpObserver?.disconnect();
    clsObserver?.disconnect();
    fidObserver?.disconnect();
    longTaskObserver?.disconnect();
    cleanupFpsDisplay();
    // Remove event listeners
    document.removeEventListener("DOMContentLoaded", handleDOMContentLoaded);
    window.removeEventListener("keydown", handleFpsToggleKeydown);
  },
};

// Log the initial start event
if (ENABLE_TICK_LOGGING) {
  tick.add("start", true);
}

export { tick, type AnimationMetrics, type FrameDropInfo };
