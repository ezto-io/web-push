import { getCameraAccess } from "./camera.js";
import { Detector, loadModel } from "./detector.js";

const errors = {
  initError: {
    name: "InitError",
    message: "Failed to Initialize.",
  },
  loadUiError: {
    name: "UIRenderError",
    message: "Failed to render the UI.",
  },
  removeUiError: {
    name: "RemoveUIError",
    message: "Failed to remove the UI.",
  },
  videoRecorderError: {
    name: "videoRecorderError",
    message: "Video stream is null, cannot stop recording.",
  },
  faceNotCenteredError: {
    name: "FaceNotCenteredError",
    message: "Face not centered for long time.",
  },
};

class Liveness {
  uiComponent = `
      <div class="liveness-video-container-y5g9u form-body-q3w8r d-flex-p5n2l" id="liveness-video-component-wrapper">
        <div class="video-inner-element-d8n2q video-element-j7p3r">
            <video id="video-element" class="rounded" autoplay playsinline muted></video>
        </div>
        <div class="video-inner-element-d8n2q shadow-overlay-f3l7w face-failure-border-h4m8y" id="video-shadow-element"></div>
        <div class="video-inner-element-d8n2q info-element-l2s5x pt-3">
            <p id="liveness-flow-instruction" class="text-center liveness-instruction-text-e7h3k px-2">
                Align your face to the center of the recording.
            </p>
            <div class="d-flex-p5n2l justify-content-center-m8h4v position-relative-r9t7z align-items-center-k6j3x">
              <ul id="liveness-flows" class="d-flex-p5n2l flex-wrap justify-content-center-m8h4v px-2 mb-5 liveness-flows-x7k9m">
                <li class="flow-status-card-n9w6v d-none-w2q8n align-items-center-k6j3x" id="fingerCount">
                    <img class="status-img-a4f1s">
                    <span class="text-white">FingerCount</span>
                </li>
                <li class="flow-status-card-n9w6v d-none-w2q8n align-items-center-k6j3x" id="blink">
                    <img class="status-img-a4f1s">
                    <span class="text-white">Blink</span></li>
                <li class="flow-status-card-n9w6v d-none-w2q8n align-items-center-k6j3x" id="speech">
                    <img class="status-img-a4f1s">
                    <span class="text-white">Speech</span>
                </li>
                <li class="flow-status-card-n9w6v d-none-w2q8n align-items-center-k6j3x" id="movement">
                    <img class="status-img-a4f1s">
                    <span class="text-white">Movement</span>
                </li>
              </ul>
            </div>
        </div>
      </div>`;

  loaderSrc = "./assets/circular-loader.gif";
  completedSrc = "./assets/completed-tick.svg";
  metadata = null;

  constructor(
    config = {},
    resourcesPath = "/assets",
    containerId = "liveness",
    onLoaded,
    onError,
    onCompleted,
    onFileProcessed
  ) {
    this.detector = null;
    this.resourcesPath = "/assets";
    this.videoRecorder = null;
    this.videoStream = null;
    this.frameRate = 12;
    this.videoBlobsRecorded = [];
    this.videoFile = null;
    this.faceBorderElement = null;

    this.completedFlows = [];
    const defaultConfig = {
      fingerCount: {
        enabled: true,
        expected: 4,
      },
      blink: {
        enabled: true,
        expected: 3,
      },
      speech: {
        enabled: true,
        expected: "Hat",
      },
      movement: {
        enabled: true,
      },
    };

    this.config = {
      ...defaultConfig,
      fingerCount: { ...defaultConfig.fingerCount, ...config.fingerCount },
      blink: { ...defaultConfig.blink, ...config.blink },
      speech: { ...defaultConfig.speech, ...config.speech },
      movement: { ...defaultConfig.movement, ...config.movement },
    };

    this.helpText = {
      alignFaceText: "Align your face to the center of the recording.",
      movementText: "Turn your face towards left and right.",
      speechText: "Say the word $$ aloud within 5 seconds",
      blinkText: "Blink your eyes $$ time(s).",
      fingerCountText:
        "Show $$ finger(s) with your full palm visible in the frame and with face centered in the oval.",
      fingerCount: "FingerCount",
      movement: "Movement",
      speech: "Speech",
      blink: "Blink",
    };

    this.containerId = containerId;
    this.resourcesPath = resourcesPath;

    this.onError = onError || (() => {});
    this.onCompleted = onCompleted || (() => {});
    this.onFileProcessed = onFileProcessed || (() => {});
    this.onLoaded = onLoaded || (() => {});
  }

  init = async () => {
    try {
      const model = await loadModel(this.config);
      this.detector = new Detector(this.config, 256, 320, model);
      this.onLoaded();
    } catch (error) {
      this.onError(error);
    }
  };

  retry = () => {
    this.removeUi();
    if (this.videoRecorder) {
      this.videoRecorder.stop();
    }
    this.completedFlows = [];
    if (this.detector) {
      this.detector.destroy();
      this.detector = null;
    }
    this.videoFile = null;
    this.init();
  };

  renderUi = () => {
    const uiContainer = document.getElementById(this.containerId);
    uiContainer.innerHTML = this.uiComponent;
    this.faceBorderElement = document.getElementById("video-shadow-element");
  };

  destroy = () => {
    // Stop recording
    if (this.videoRecorder) {
      this.videoRecorder.stop();
      this.videoRecorder = null;
    }
    
    // Stop video stream
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
      this.videoStream = null;
    }
    
    // Clean up detector
    if (this.detector) {
      this.detector.destroy();
      this.detector = null;
    }
  };

  updateStatusUi = (id, status) => {
    if (!id && status === "loading") return;
    const statusElement = document.getElementById(id);
    if (statusElement) {
      statusElement.classList.remove("d-none-w2q8n");
      statusElement.classList.add("d-flex-p5n2l");
      if (status === "completed") {
        statusElement.querySelector("img").src = this.completedSrc;
      } else if (status === "loading") {
        statusElement.querySelector("img").src = this.loaderSrc;
      }
    } else {
      this.onError(errors.loadUiError);
    }
  };

  removeUi = () => {
    const uiContainer = document.getElementById(this.containerId);
    if (uiContainer) {
      uiContainer.innerHTML = "";
    } else {
      this.onError(errors.removeUiError);
    }
  };

  startRecording = () => {
    const options = {
      audioBitsPerSecond: 128000,
      videoBitsPerSecond: 2500000,
    };
    this.videoRecorder = new MediaRecorder(this.videoStream, options);
    this.videoBlobsRecorded = [];
    this.videoRecorder.addEventListener("dataavailable", (e) => {
      this.videoBlobsRecorded.push(e.data);
    });
    this.videoRecorder.start(1000);
    this.videoRecorder.addEventListener("stop", async () => {
      if (this.videoStream == null) {
        this.onError(errors.videoRecorderError);
      }
      const videoBlob = new Blob(this.videoBlobsRecorded, {
        type: "video/mp4",
      });
      const videoFile = new File([videoBlob], "liveliness", {
        type: "video/mp4",
      });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(videoFile);
      this.videoFile = dataTransfer.files[0];
      const reader = new FileReader();
      this.onFileProcessed(dataTransfer.files[0]);
      reader.addEventListener(
        "load",
        () => {
          if (this.videoStream != null) {
            this.videoStream.getTracks().forEach(function (track) {
              track.stop();
            });
          }
        },
        false
      );
      reader.readAsDataURL(videoBlob);
      this.removeUi();
    });
  };

  updateFlowStatus = () => {
    this.completedFlows.forEach((flow) => {
      this.updateStatusUi(flow, "completed");
    });
  };

  flowHelperTextSetter(currentFlow) {
    const instructionElement = document.getElementById(
      "liveness-flow-instruction"
    );
    switch (currentFlow) {
      case "face_align":
        instructionElement.textContent = this.helpText.alignFaceText;
        break;
      case "fingerCount":
        instructionElement.textContent = this.helpText.fingerCountText.replace(
          "$$",
          this.config.fingerCount.expected
        );
        break;
      case "blink":
        instructionElement.textContent = this.helpText.blinkText.replace(
          "$$",
          this.config.blink.expected
        );
        break;
      case "speech":
        instructionElement.textContent = this.helpText.speechText.replace(
          "$$",
          this.config.speech.expected
        );
        break;
      case "movement":
        instructionElement.textContent = this.helpText.movementText;
        break;
    }
  }

  addDetectorEventListeners = () => {
    window.addEventListener("onLivenessUpdate", (e) => {
      if (e.detail.is_completed) {
        this.metadata = e.detail.metadata;
        this.onCompleted({
          completedFlows: e.detail.completed_flows,
          metadata: e.detail.metadata,
        });
        this.videoRecorder.stop();
      }
      this.completedFlows = e.detail.completed_flows;
      // Flow helper-text setter.
      this.flowHelperTextSetter(e.detail.in_progress);
      this.updateStatusUi(e.detail.in_progress, "loading");
      this.updateFlowStatus();
    });

    // event listener for face to be center of recording
    window.addEventListener("faceCenterUpdate", async (e) => {
      // isCenter return whether face is centered or not(Boolean)
      if (e.detail.isCenter) {
        this.faceBorderElement.classList.remove("face-failure-border-h4m8y");
        this.faceBorderElement.classList.add("face-success-border-g6k9t");
      } else {
        this.faceBorderElement.classList.remove("face-success-border-g6k9t");
        this.faceBorderElement.classList.add("face-failure-border-h4m8y");
      }
      // retry return true when face is not center for 4 seconds continuously
      if (e.detail.retry) {
        this.retry();
        this.onError(errors.faceNotCenteredError);
      }
    });
  };

  startLiveness = async () => {
    try {
      this.renderUi();
      this.videoStream = await getCameraAccess("user", true);
      const videoElement = document.getElementById("video-element");
      videoElement.srcObject = this.videoStream;
      videoElement.play();
      this.startRecording();
      await new Promise((resolve) => {
        videoElement.addEventListener("loadedmetadata", resolve, {
          once: true,
        });
      });
      this.detector.processFromVideo(videoElement, this.frameRate);
      this.addDetectorEventListeners();
    } catch (error) {
      this.onError(error);
    }
  };
}

export default Liveness;
