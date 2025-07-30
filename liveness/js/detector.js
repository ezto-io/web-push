
import {
    HandLandmarker,
    FilesetResolver,
    FaceLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

export async function loadModel(config) {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/gh/ezto-io/ezto-js@1.0.2/liveness/mediapipe"
    );
    const [fLandmarker, hLanderMarker] = await Promise.allSettled([loadFaceLandMarker(vision), loadHandLandMarker(vision, config)]);
    if (fLandmarker.status === "fulfilled" && hLanderMarker.status === "fulfilled") {
        return { fLandmarker: fLandmarker.value, hLanderMarker: hLanderMarker.value };
    } else {
        throw new Error("Model download failed");
    }
}

async function loadFaceLandMarker(vision) {
    const fLandmarker = await FaceLandmarker.createFromOptions(
        vision,
        {
            baseOptions: {
                modelAssetPath: "https://cdn.jsdelivr.net/gh/ezto-io/ezto-js@1.0.2/liveness/mediapipe/face_landmarker.task"
            },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: true,
        });

    return fLandmarker;
}

async function loadHandLandMarker(vision, config) {
    let hLanderMarker = undefined;
    if (config.fingerCount?.enabled === true) {
        hLanderMarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://cdn.jsdelivr.net/gh/ezto-io/ezto-js@1.0.2/liveness/mediapipe/hand_landmarker.task`,
            },
            runningMode: 'VIDEO',
            numHands: 1,
        });
    }
    return hLanderMarker;
}

export class Detector {
    constructor(config, ovalWidth, ovalHeight, model) {
        this._initState(config, ovalWidth, ovalHeight, model)
    }

    _initState(config, ovalWidth, ovalHeight, model) {
        if (config.hasOwnProperty('selfie')) {
            this.config = {
                ...config,
                "blink": {
                    "enabled": false,
                },
                "fingerCount": {
                    "enabled": false,
                },
                "movement": {
                    "enabled": false,
                },
                "speech": {
                    "enabled": false,
                },
            };
        } else {
            this.config = {
                ...config,
                "selfie": {
                    "enabled": false
                }
            };
        }
        this.faceAlignState = {
            faceCenterPadding: 20,
            completed: false,
            lastFaceAlignState: undefined,
            numberOfContinuousFalse: 0,
            continuousFalseWaitFrame: 48,
            numberOfContinuousTrue: 0,
            continuousTrueWaitFrame: 36,
            retryTriggered: false,
            selfieState: false,
            isSelfie: config.hasOwnProperty('selfie') ? true : false,
        }
        this.captureFrameTimer = undefined;
        this.speechFrameTimer = undefined;
        this.videoWidth = undefined;
        this.videoHeight = undefined;
        this.faceLandmarker = model.fLandmarker;
        this.handLandmarker = model.hLanderMarker;
        this.ovalWidth = ovalWidth;
        this.ovalHeight = ovalHeight;
        this.videoElement = undefined;
        this.videoCallbackId = undefined;
        this.videoTimeOffset = -1;
        this.speechState = {
            "started": false,
            "completed": false,
            "timeout": 5000,
            "time": {
                "start": undefined,
                "end": undefined,
            }
        }

        this.fingerPoints = {
            "index": [8, 7, 6, 5],
            "middle": [12, 11, 10, 9],
            "ring": [16, 15, 14, 13],
            "pinky": [20, 19, 18, 17],
            "thumb": [4, 3, 2],
        }
        this.fingerState = {
            "count": 0,
            "time": {
                "start": undefined,
                "end": undefined,
            }
        }
        this.blinkState = {
            "count": 0,
            "lastIsEyeOpen": true,
            "time": {
                "start": undefined,
                "end": undefined,
            }

        }
        this.movementPoints = {
            "leftEar": 454,
            "rightEar": 234,
            "threshold": 35,
        }
        this.movementState = {
            "minX": 0,
            "maxX": 0,
            "lastIsEyeOpen": true,
            "time": {
                "start": undefined,
                "end": undefined,
            }
        }

        var enabledKeys = [];
        // Iterate over the keys of the config object
        Object.keys(config).forEach(key => {
            // Check if the enabled property is true for the current key
            if (config[key].enabled === true) {
                // Add the key to the enabledKeys array
                enabledKeys.push(key);
            }
        });

        this.requiredFlow = enabledKeys;
        this.pendingFlow = enabledKeys;
        this.inProgress = "face_align";
        this.completedFlow = [];
        this.isDestroyed = false;
    }

    destroy() {
        try {
            this.isDestroyed = true;
            if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
                this.videoElement?.cancelVideoFrameCallback(this.videoCallbackId);
            }
            clearTimeout(this.captureFrameTimer);
            // console.log("captureFrameTimer destroyed")
            clearTimeout(this.speechFrameTimer);
            // console.log("speechFrameTimer destroyed")
        } catch (error) {
            // console.log("Destroying object failed")
        }
    }

    compareDetectorResult(lastDetectorResult, currentDetectorResult) {
        if (lastDetectorResult === undefined) return true;
        if (lastDetectorResult.in_progress !== currentDetectorResult.in_progress) {
            return true;
        }
        if (lastDetectorResult.pending_flows.length !== currentDetectorResult.pending_flows.length) {
            return true;
        }
        if (lastDetectorResult.completed_flows.length !== currentDetectorResult.completed_flows.length) {
            return true;
        }
        return false;
    }

    processFromVideo(videoElement, frameRate) {
        // const audioContext = new AudioContext();
        // const analyser = audioContext.createAnalyser();
        // analyser.fftSize = 2048;
        // const videoStream = videoElement.captureStream();
        // const audioTracks = videoStream.getAudioTracks();
        // const audioTrack = audioTracks[0];
        // const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
        // // Connect the source to the analyser
        // source.connect(analyser);
        // const bufferLength = analyser.frequencyBinCount;
        // const dataArray = new Uint8Array(bufferLength);


        this.videoElement = videoElement;
        this.videoHeight = videoElement.videoHeight;
        this.videoWidth = videoElement.videoWidth;
        let compareDetectorResult = this.compareDetectorResult.bind(this);
        function captureFrame() {
            // analyser.getByteFrequencyData(dataArray);
            // // Calculate average frequency
            // let sum = 0;
            // for (let i = 0; i < bufferLength; i++) {
            //     sum += dataArray[i];
            // }
            // const averageFrequency = sum / bufferLength;

            // console.log('Average frequency:', averageFrequency);
            if (this.lastDetectorResult?.is_completed === true || this.isDestroyed) {
                // console.log("Flow completed");
                return;
            }
            if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
                this.videoCallbackId = videoElement.requestVideoFrameCallback(captureFrame.bind(this));
            } else {
                this.captureFrameTimer = setTimeout(() => {
                    requestAnimationFrame(captureFrame.bind(this))
                }, 1000 / frameRate);
            }
            const detectorResult = this.detectInFrame(videoElement);
            if (compareDetectorResult(this.lastDetectorResult, detectorResult)) {
                this.lastDetectorResult = detectorResult;
                let onLivenessUpdate = new CustomEvent("onLivenessUpdate", { detail: detectorResult });
                window.dispatchEvent(onLivenessUpdate)
            }
        }
        captureFrame.bind(this)();
    }


    //Movement can be done in Parallel
    //Blink should be first
    //fingerCount should be next
    //Speech should be done at end
    detectInFrame(video) {
        if (this.videoTimeOffset === -1) {
            this.videoTimeOffset = video.currentTime;
        }

        const currentTime = video.currentTime - this.videoTimeOffset;
        const faceLandmarkerResult = this.faceLandmarker.detectForVideo(video, performance.now())
        const faceCenterResult = this.startFaceCenterChecking(video, faceLandmarkerResult);

        if (this.faceAlignState.completed) {
            if (faceCenterResult) {
                this.faceAlignState.numberOfContinuousTrue = this.faceAlignState.numberOfContinuousTrue + 1;
            }
            if (this.faceAlignState.lastFaceAlignState !== faceCenterResult) {
                this.faceAlignState.lastFaceAlignState = faceCenterResult;
                this.faceAlignState.numberOfContinuousFalse = 0;
                if ((this.faceAlignState.retryTriggered === false || this.faceAlignState.isSelfie) && this.faceAlignState.selfieState === false) {
                    const faceCenterEvent = new CustomEvent('faceCenterUpdate', { detail: { isCenter: faceCenterResult, retry: false, takeSelfie: false } });
                    window.dispatchEvent(faceCenterEvent);
                }
            } else if (this.faceAlignState.lastFaceAlignState === false && faceCenterResult === false) {
                this.faceAlignState.numberOfContinuousFalse = this.faceAlignState.numberOfContinuousFalse + 1;
                this.faceAlignState.numberOfContinuousTrue = 0;
                if (this.faceAlignState.numberOfContinuousFalse >= this.faceAlignState.continuousFalseWaitFrame) {
                    if ((this.faceAlignState.retryTriggered === false || this.faceAlignState.isSelfie) && this.faceAlignState.selfieState === false) {
                        this.faceAlignState.retryTriggered = true;
                        //Send failure result and end the process
                        const faceCenterEvent = new CustomEvent('faceCenterUpdate', { detail: { isCenter: faceCenterResult, retry: true, takeSelfie: false } });
                        window.dispatchEvent(faceCenterEvent);
                    }
                }
            }
        }

        if (this.inProgress === "face_align") {
            if (faceCenterResult && !this.faceAlignState.completed) {
                this.faceAlignState.completed = true;
                this.faceAlignState.lastFaceAlignState = true;
                this.inProgress = this.pendingFlow[0]
                const faceCenterEvent = new CustomEvent('faceCenterUpdate', { detail: { isCenter: faceCenterResult, retry: false, takeSelfie: false } });
                window.dispatchEvent(faceCenterEvent);
            }
        } else if (this.config.selfie.enabled) {
            if (this.faceAlignState.numberOfContinuousTrue >= this.faceAlignState.continuousTrueWaitFrame && this.faceAlignState.selfieState === false) {
                this.faceAlignState.selfieState = true;
                const faceCenterEvent = new CustomEvent('faceCenterUpdate', { detail: { isCenter: faceCenterResult, retry: true, takeSelfie: true } });
                window.dispatchEvent(faceCenterEvent);
            }
        } else if ((this.config.blink.enabled && this.inProgress === "blink") || (this.config.movement.enabled && this.inProgress === "movement")) {
            if (this.blinkState.time.start === undefined) {
                this.blinkState.time.start = currentTime;
            }
            if (this.config.blink.enabled && this.inProgress === "blink") {
                if (faceLandmarkerResult.faceBlendshapes && faceLandmarkerResult.faceBlendshapes[0]) {
                    const isBlinkCompleted = this.isBlinkCompleted(faceLandmarkerResult.faceBlendshapes[0].categories);

                    if (isBlinkCompleted) {
                        this.blinkState.time.end = currentTime;
                        this.completedFlow.push("blink")
                        this.pendingFlow = this.pendingFlow.filter(item => item !== "blink");
                        this.inProgress = this.pendingFlow[0]
                    }
                }

            } else if (this.config.movement.enabled && this.inProgress === "movement") {

                if (faceLandmarkerResult.faceLandmarks.length !== 0) {
                    if (this.movementState.time.start === undefined) {
                        if (currentTime > 1) {
                            this.movementState.time.start = currentTime - 1;
                        } else {
                            this.movementState.time.start = currentTime;
                        }
                    }
                    let distance = this.euclideanDistance(faceLandmarkerResult.faceLandmarks[0][454], faceLandmarkerResult.faceLandmarks[0][234])
                    if (this.movementState.minX === 0 && this.movementState.maxX === 0) {
                        this.movementState.minX = distance;
                        this.movementState.maxX = distance;
                    } else {
                        this.movementState.minX = Math.min(this.movementState.minX, distance)
                        this.movementState.maxX = Math.max(this.movementState.maxX, distance)
                    }

                    if ((this.movementState.maxX - this.movementState.minX) >= this.movementPoints.threshold) {
                        this.movementState.time.end = currentTime;
                        this.completedFlow.push("movement")
                        this.pendingFlow = this.pendingFlow.filter(item => item !== "movement");
                        this.inProgress = this.pendingFlow[0]
                    }
                }
            }
        } else if (this.config.fingerCount.enabled && this.inProgress === "fingerCount") {
            let currentOpenFingers = 0;
            const handLandmarkerResult = this.handLandmarker.detectForVideo(video, performance.now());
            //TODO: Add logic for fingerCount
            if (handLandmarkerResult.landmarks.length === 1) {
                if (this.isHandInFrame(handLandmarkerResult.landmarks[0])) {
                    let isThumbOpen = this.isThumbOpen(this.fingerPoints.thumb, handLandmarkerResult.landmarks[0])
                    if (isThumbOpen) {
                        currentOpenFingers++;
                    }

                    let isIndexOpen = this.isFingerOpen(this.fingerPoints.index, handLandmarkerResult.landmarks[0]);
                    if (isIndexOpen) {
                        currentOpenFingers++;
                    }

                    let isMiddleOpen = this.isFingerOpen(this.fingerPoints.middle, handLandmarkerResult.landmarks[0]);
                    if (isMiddleOpen) {
                        currentOpenFingers++;
                    }

                    let isRingOpen = this.isFingerOpen(this.fingerPoints.ring, handLandmarkerResult.landmarks[0]);
                    if (isRingOpen) {
                        currentOpenFingers++;
                    }

                    let isPinkyOpen = this.isFingerOpen(this.fingerPoints.pinky, handLandmarkerResult.landmarks[0]);
                    if (isPinkyOpen) {
                        currentOpenFingers++;
                    }
                }
                const expectedCount = this.config.fingerCount.expected
                if (currentOpenFingers === expectedCount) {
                    this.fingerState.time.start = video.currentTime - this.videoTimeOffset - 0.5;
                    this.fingerState.time.end = video.currentTime - this.videoTimeOffset + 0.5;
                    this.completedFlow.push("fingerCount")
                    this.pendingFlow = this.pendingFlow.filter(item => item !== "fingerCount");
                    this.inProgress = this.pendingFlow[0]
                }

            }
            // if (handLandmarkerResult.landmarks.length !== 0) {
            //     this.completedFlow.push("fingerCount")
            //     this.pendingFlow = this.pendingFlow.filter(item => item !== "fingerCount");
            //     this.inProgress = this.pendingFlow[0]

            // }
        } else if (this.config.speech.enabled && this.inProgress === "speech") {
            if (!this.speechState.started) {
                this.speechState.started = true;
                this.speechState.time.start = currentTime;
                this.speechFrameTimer = setTimeout(() => {
                    this.speechState.completed = true;
                }, this.speechState.timeout);
            } else if (this.speechState.completed) {
                this.speechState.time.end = currentTime;
                this.completedFlow.push("speech")
                this.pendingFlow = this.pendingFlow.filter(item => item !== "speech");
                this.inProgress = this.pendingFlow[0]
            }
        }

        let result = {
            "required_flows": this.requiredFlow,
            "completed_flows": this.completedFlow,
            "pending_flows": this.pendingFlow,
            "in_progress": this.inProgress,
            "is_completed": this.pendingFlow.length === 0,
        };

        if (result.is_completed === true) {
            result = {
                ...result,
                "metadata": {
                    "blink": {
                        "video": this.blinkState.time
                    },
                    "movement": {
                        "video": this.movementState.time,
                    },
                    "fingerCount": {
                        "video": this.fingerState.time,
                    },
                    "speech": {
                        "video": this.speechState.time,
                    }
                }
            }
        }

        return result;
    }

    isHandInFrame(landmarks) {
        for (let point of landmarks) {
            let nCoords = this.normalizeCoords(point)
            let padding = 10;

            if (nCoords.x > this.videoWidth - padding || nCoords.x < padding || nCoords.y > this.videoHeight - padding || nCoords.y < padding) {
                return false; // Out of bounds
            }
        }
        return true;
    }

    isThumbOpen(fingerPoints, landmarks) {
        let indexTipXCoord = landmarks[5].x
        let pinkyMcpXCoord = landmarks[17].x
        let isThumbInLeft = indexTipXCoord < pinkyMcpXCoord
        let bottom = this.normalizeCoords(landmarks[fingerPoints[0]]);
        let middle = this.normalizeCoords(landmarks[fingerPoints[1]]);
        let top = this.normalizeCoords(landmarks[fingerPoints[2]]);
        if (isThumbInLeft) {
            if ((bottom.x + 20) < middle.x && (middle.x) + 20 < top.x) {
                return true;
            }
        } else {
            if (bottom.x > (middle.x + 20) && (middle.x) > (top.x + 20)) {
                return true;
            }
        }

        return false;
    }

    isFingerOpen(fingerPoints, landmarks) {
        let low1 = this.normalizeCoords(landmarks[fingerPoints[0]]);
        let low2 = this.normalizeCoords(landmarks[fingerPoints[1]]);
        let low3 = this.normalizeCoords(landmarks[fingerPoints[2]]);
        let low4 = this.normalizeCoords(landmarks[fingerPoints[3]]);
        return (low1.y < low2.y && low2.y < low3.y && low3.y < low4.y)
    }

    isBlinkCompleted(faceBlendCategories) {
        const expectedBlink = this.config.blink.expected;
        const rightEye = (data) => data.find(item => item.categoryName === "eyeBlinkRight");
        const leftEye = (data) => data.find(item => item.categoryName === "eyeBlinkLeft");

        const rightEyeScore = rightEye(faceBlendCategories).score
        const leftEyeScore = leftEye(faceBlendCategories).score
        if (rightEyeScore > 0.30 && leftEyeScore > 0.30) {
            if (this.blinkState.lastIsEyeOpen === true) {
                this.blinkState.lastIsEyeOpen = false;
            }
        } else {
            if (this.blinkState.lastIsEyeOpen === false) {
                this.blinkState.lastIsEyeOpen = true;
                this.blinkState.count = this.blinkState.count + 1;
            }
        }
        return expectedBlink === this.blinkState.count;
    }

    normalizeCoords(point) {
        return {
            "x": point.x * this.videoWidth,
            "y": point.y * this.videoHeight,
        }
    }

    euclideanDistance(point, point1) {
        return Math.sqrt((point1.x * this.videoWidth - point.x * this.videoWidth) ** 2 + (point1.y * this.videoHeight - point.y * this.videoHeight) ** 2)
    }



    startFaceCenterChecking(videoElement, detectorResult) {
        if (!this.faceLandmarker) {
            console.error("FaceLandmarker is not initialized");
            return false;
        }
        // Check if a face is detected
        const isFaceDetected = detectorResult.faceLandmarks.length > 0;

        // Check if the face is centered
        const isFaceCentered = isFaceDetected ? this.isFaceCentered(detectorResult.faceLandmarks, videoElement.videoWidth, videoElement.videoHeight) : false;

        // Send data indicating whether the face is centered
        console.log("Is face centered:", isFaceCentered);
        return isFaceCentered;
    }



    isFaceCentered(faceLandmarks, videoWidth, videoHeight) {
        if (faceLandmarks.length === 0) {
            return false; // Returning false when no face is detected
        }

        const leftEar = faceLandmarks[0][234];
        const rightEar = faceLandmarks[0][454];
        const headTop = faceLandmarks[0][10];
        const chin = faceLandmarks[0][152];

        const faceWidth = Math.abs(rightEar.x - leftEar.x) * videoWidth;;
        const faceHeight = Math.abs(chin.y - headTop.y) * videoHeight;;

        if (this.ovalWidth > faceWidth && this.ovalHeight > faceHeight) {
            const videoCentreWidth = videoWidth / 2;
            const videoCentreHeight = videoHeight / 2;

            const ovalStartX = videoCentreWidth - (this.ovalWidth / 2);
            const ovalEndX = ovalStartX + this.ovalWidth
            const ovalStartY = videoCentreHeight - (this.ovalHeight / 2);
            const ovalEndY = ovalStartY + this.ovalHeight

            const faceStartX = (leftEar.x + rightEar.x) / 2 * videoWidth - faceWidth / 2;
            const faceEndX = faceStartX + faceWidth;
            const faceStartY = (headTop.y + chin.y) / 2 * videoHeight - faceHeight / 2;
            const faceEndY = faceStartY + faceHeight;

            if (faceStartX >= (ovalStartX + this.faceAlignState.faceCenterPadding) && faceEndX <= (ovalEndX - this.faceAlignState.faceCenterPadding) &&
                faceStartY >= ovalStartY - this.faceAlignState.faceCenterPadding && faceEndY <= (ovalEndY + this.faceAlignState.faceCenterPadding)) {
                //Once user is inside circle, relax the restrictions of padding to avoid changes when face is moved to small amount
                this.faceAlignState.faceCenterPadding = 0;
                return true;
            } else {
                return false; // Returning false when face center is not within the oval
            }
        } else {
            return false; // Returning false when face does not fit within the oval
        }
    }
}