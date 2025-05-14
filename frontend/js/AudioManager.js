class AudioManager {
    constructor(audioElementId = 'stage-audio') {
        this.audioElement = document.getElementById(audioElementId);
        if (!this.audioElement) {
            console.error(`Audio element with ID '${audioElementId}' not found.`);
            // Optionally, create an audio element if one isn't provided
            // this.audioElement = document.createElement('audio');
            // document.body.appendChild(this.audioElement);
        }
        this.musicAudioElement = new Audio(); // Dedicated element for music tracks
        this.musicAudioElement.loop = true; // Music usually loops
        this.audioUnlocked = false;
        this.pendingSounds = []; // Sounds to play once unlocked
        this.sounds = {}; // To store sound definitions { name: { src, loop, element } }
        this.currentMusicName = null; // Track current playing music

        this._initializeUnlockListener();
        console.log('AudioManager initialized.');
    }

    _initializeUnlockListener() {
        const unlockHandler = () => {
            if (this.audioUnlocked) return;
            this.audioUnlocked = true;
            console.log('AudioManager: Audio unlocked by user interaction.');
            
            // Attempt to play any pending sounds
            while (this.pendingSounds.length > 0) {
                const soundToPlayObj = this.pendingSounds.shift(); // e.g., { name: 'stage0Music' }
                if (soundToPlayObj && soundToPlayObj.name && this.sounds[soundToPlayObj.name]) {
                    console.log(`AudioManager: Attempting to play pending sound '${soundToPlayObj.name}' after unlock.`);
                    this.playSound(soundToPlayObj.name); // Call the main playSound method
                } else if (soundToPlayObj) {
                    console.warn(`AudioManager: Pending sound '${soundToPlayObj.name}' not found in loaded sounds or invalid object.`);
                }
            }
            // Remove listeners after first interaction
            document.body.removeEventListener('click', unlockHandler, { capture: true });
            document.body.removeEventListener('keydown', unlockHandler, { capture: true });
        };

        document.body.addEventListener('click', unlockHandler, { capture: true, once: true });
        document.body.addEventListener('keydown', unlockHandler, { capture: true, once: true });
    }

    // More sophisticated sound loading might involve multiple audio elements
    // For now, we assume one primary audio element for stage sounds or simple effects.
    loadSound(name, src, loop = false) {
        let soundElement;
        if (loop) { // Looping sounds (music) can use the main shared element or a dedicated one
            soundElement = this.musicAudioElement; // Use dedicated music element
            soundElement.src = src; // Pre-load music src
            soundElement.loop = true;
            this.sounds[name] = { name, src, loop, element: soundElement, isMusic: true };
        } else { // Non-looping sounds (SFX) get their own Audio element for concurrent playback
            soundElement = new Audio(src);
            soundElement.loop = false; // loop is false by default for Audio, but explicit
            this.sounds[name] = { name, src, loop, element: soundElement, isMusic: false };
        }
        console.log(`AudioManager: Sound '${name}' loaded. Loop: ${loop}. Element:`, soundElement);
    }

    _playInternal(soundName, audioElement) { // audioElement parameter is now the specific element for the sound
        const sound = this.sounds[soundName];
        if (!sound) {
            console.warn(`AudioManager: Sound '${soundName}' not loaded.`);
            return;
        }

        if (!audioElement) { // Should always be sound.element passed from playSound
            console.error(`AudioManager: No audio element available for '${soundName}'.`);
            return;
        }

        // console.log(`AudioManager: Attempting to play '${soundName}' on element:`, audioElement);
        // For non-music elements, src is set at creation. For music, it might be re-set if changing tracks.
        if (sound.isMusic && audioElement.src !== sound.src) { 
           audioElement.src = sound.src;
           audioElement.load(); // Ensure new music track is loaded
        }
        audioElement.loop = sound.loop; // Ensure loop status is correct

        // For SFX, if it's already playing, we might want to stop and restart, or allow multiple instances (if elements are pooled)
        if (!sound.isMusic) {
            audioElement.currentTime = 0; // Restart SFX from the beginning
        }

        const playPromise = audioElement.play();
        if (playPromise !== undefined) {
            playPromise.then(_ => {
                console.log(`AudioManager: Playing '${soundName}'.`);
            }).catch(error => {
                console.warn(`AudioManager: Error playing '${soundName}':`, error);
                if (!this.audioUnlocked && error.name === 'NotAllowedError') {
                    console.log(`AudioManager: Queuing '${soundName}' due to NotAllowedError.`);
                    if (!this.pendingSounds.find(s => s.name === soundName)) {
                        this.pendingSounds.push({ name: sound.name }); // Use sound.name from the object
                    }
                }
            });
        }
    }

    playSound(soundName) {
        const sound = this.sounds[soundName];
        if (!sound) {
            console.warn(`AudioManager: Sound '${soundName}' not loaded, cannot play.`);
            return;
        }
        
        const targetElement = sound.element; // Always use the element defined in the sound object

        if (this.audioUnlocked) {
            if (sound.isMusic) {
                // Stop other music if any is playing on the musicAudioElement
                if (this.currentMusicName && this.currentMusicName !== soundName) {
                    const currentMusicSound = this.sounds[this.currentMusicName];
                    if (currentMusicSound && currentMusicSound.element) {
                        console.log(`AudioManager: Stopping other music '${this.currentMusicName}' before playing '${soundName}'.`);
                        currentMusicSound.element.pause();
                        currentMusicSound.element.currentTime = 0;
                    }
                }
                this.currentMusicName = soundName;
                console.log(`AudioManager: Set currentMusicName to '${soundName}'.`);
                this._playInternal(soundName, targetElement);
            } else {
                this._playInternal(soundName, targetElement); // SFX are played directly
            }
        } else {
            console.log(`AudioManager: Audio not unlocked. Queuing '${soundName}'.`);
            if (!this.pendingSounds.find(s => s.name === soundName)) { // Avoid duplicates
                 this.pendingSounds.push({ name: soundName });
            }
        }
    }

    stopSound(soundName) {
        const sound = this.sounds[soundName];
        if (!sound) {
            console.warn(`AudioManager: Sound '${soundName}' not loaded, cannot stop.`);
            return;
        }
        const targetElement = sound.element; 

        if (targetElement && !targetElement.paused && targetElement.src.includes(sound.src)) {
            targetElement.pause();
            targetElement.currentTime = 0;
            console.log(`AudioManager: Sound '${soundName}' stopped.`);
        }
    }

    setStageMusic(musicName) {
        // Stop currently playing music first, if any
        if (this.currentMusicName && this.sounds[this.currentMusicName]) {
            const oldMusic = this.sounds[this.currentMusicName];
            if (oldMusic.element) {
                console.log(`AudioManager: Attempting to stop music '${this.currentMusicName}'. Current src: ${oldMusic.element.src}`);
                oldMusic.element.pause();
                oldMusic.element.currentTime = 0;
                console.log(`AudioManager: Stopped music '${this.currentMusicName}'. Paused: ${oldMusic.element.paused}`);
            }
            this.currentMusicName = null;
            console.log(`AudioManager: Cleared currentMusicName.`);
        }

        if (musicName && this.sounds[musicName]) {
            const newMusic = this.sounds[musicName];
            if (newMusic.isMusic) {
                console.log(`AudioManager: Attempting to play new stage music '${musicName}'.`);
                this.playSound(musicName);
            } else {
                console.warn(`AudioManager: '${musicName}' is not designated as music. Cannot set as stage music.`);
            }
        } else if (musicName) {
            console.warn(`AudioManager: Music '${musicName}' not loaded.`);
        }
    }
}

// Export the class if you plan to use it as an ES6 module
// export default AudioManager; // Uncomment if index.html uses <script type="module"> for AudioManager.js
