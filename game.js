
/*
 * KEYBOARD WARRIOR MAGE - CODE MAP
 *
 * This file runs the game. The other files have simple jobs:
 * - index.html: viewport canvas, menus, buttons, and screen text.
 * - index.css: layout, pixel backgrounds, colors, buttons, overlays, and responsive styling.
 * - start-bg.svg: pixel-art title scene shown on the opening menu.
 * - map1.svg: replaceable pixel-art battleground shown during play.
 * - enemy-*.svg: pixel-art sprites for fire, ice, lightning, and holy enemies.
 * - mage.svg: pixel-art wizard sprite used for the player character.
 * - game.js: enemies, typing, score, pause/resume, sound, and the game loop.
 *
 * Main gameplay flow:
 * 1. startGame() resets the run and starts the animation loop.
 * 2. gameLoop() uses elapsed time to smoothly spawn, move, and draw enemies.
 * 3. The keyboard handler matches typed letters to an enemy word.
 * 4. Completing a word awards points, plays its element sound, and removes it.
 * 5. Reaching the wizard triggers game over. Pause/resume and quit are handled
 *    separately so the active run can be stopped without losing its state.
 *
 * Function guide:
 * - Enemy.constructor(): creates an enemy and chooses its word and element.
 * - Enemy.update(): smoothly moves an enemy and checks for collision.
 * - Enemy.draw(): draws the enemy, element color, and typed word progress.
 * - Enemy.checkNextChar(): checks and records the next typed letter.
 * - Enemy.isComplete(): reports whether the enemy word is finished.
 * - resizeCanvas(): makes the canvas and game world match the browser viewport.
 * - startGame(): resets score and enemies, then starts a new run.
 * - initializeAudio(): unlocks the browser audio system after a button click.
 * - startBackgroundMusic(): starts the quiet retro gameplay melody.
 * - pauseBackgroundMusic(): ducks the melody while the game is paused.
 * - resumeBackgroundMusic(): restores the melody after the pause countdown.
 * - stopBackgroundMusic(): ends the melody on game over or quit.
 * - playTypingSound(): plays a mechanical keyboard click for each correct letter.
 * - playDefeatSound(): plays the sound matching the counter-spell element.
 * - fireSpellBolt(): creates a visual spell shot for a correct letter.
 * - drawWizard(): renders the mage and turns it toward the current target.
 * - drawSpellProjectile(): draws the counter-spell's pixel projectile shape.
 * - updateAndDrawSpellEffects(): animates and renders active spell shots.
 * - pauseGame(): freezes the run and opens the pause menu.
 * - resumeGame(): counts down from three, then continues the paused run.
 * - quitToStart(): clears the run and returns to the opening screen.
 * - triggerGameOver(): saves high score data and opens the results screen.
 * - keyboard handler: pauses/resumes with Escape and types spell letters.
 * - gameLoop(): runs one time-adjusted frame of spawning, movement, drawing, and HUD updates.
 *
 * Game states: START -> PLAYING -> PAUSED/COUNTDOWN -> PLAYING or GAMEOVER.
 */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game State Variables
let gameState = 'START'; // 'START', 'PLAYING', 'PAUSED', 'COUNTDOWN', 'GAMEOVER'
let score = 0;  
let highScore = localStorage.getItem('wizard_highscore') || 0;
let startTime = 0;
let elapsedTime = 0;
let pauseStartedAt = 0;
let countdownTimer = null;
let audioContext = null;
let musicTimer = null;
let musicGain = null;
let musicStep = 0;

let spawnTimer = 0;
let baseSpawnInterval = 180; // Starts at ~3 seconds
let lastFrameTime = 0;
let activeEnemies = [];
let currentTarget = null;
let spellEffects = [];

const wizard = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    radius: 24,
    color: '#3498db'
};

// Match the canvas coordinate system to the full browser viewport.
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    wizard.x = canvas.width / 2;
    wizard.y = canvas.height / 2;
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Draw the upright mage and mirror it when the target is to the left.
function drawWizard() {
    const facingLeft = currentTarget && currentTarget.x < wizard.x;

    if (mageSprite.complete && mageSprite.naturalWidth > 0) {
        ctx.save();
        ctx.translate(wizard.x, wizard.y);
        ctx.scale(facingLeft ? -1 : 1, 1);
        ctx.drawImage(mageSprite, -32, -40, 64, 80);
        ctx.restore();
        return;
    }

    ctx.beginPath();
    ctx.arc(wizard.x, wizard.y, wizard.radius, 0, Math.PI * 2);
    ctx.fillStyle = wizard.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
}

// Word banks and counter-spell matchups organized by enemy element.
// Blue ice -> fire, red fire -> ice, yellow lightning -> holy, brown holy -> holy.
const spellData = {
    fire: { 
        color: '#e74c3c', 
        counterSpell: 'ice',
        easy: ["burn", "fire", "ash", "heat"], 
        hard: ["fireball", "ignite", "inferno", "scorch", "pyroblast"] 
    },
    ice: { 
        color: '#3498db', 
        counterSpell: 'fire',
        easy: ["ice", "cold", "snow", "chill"], 
        hard: ["freeze", "glacier", "blizzard", "frostbite", "avalanche"] 
    },
    lightning: { 
        color: '#f1c40f', 
        counterSpell: 'holy',
        easy: ["zap", "bolt", "jolt", "volt"], 
        hard: ["thunder", "spark", "overload", "electrocute", "lightning"] 
    },
    holy: { 
        color: '#e67e22', 
        counterSpell: 'holy',
        easy: ["ray", "dawn", "glow", "pure"], 
        hard: ["purify", "exorcise", "smite", "sanctuary", "radiance"] 
    }
};

const enemyTypes = Object.keys(spellData);
const enemySprites = Object.fromEntries(enemyTypes.map(type => {
    const sprite = new Image();
    sprite.src = `enemy-${type}.svg`;
    return [type, sprite];
}));
const mageSprite = new Image();
mageSprite.src = 'mage.svg';

class Enemy {
    // Create one enemy with a position, element, word, and difficulty-scaled speed.
    constructor(difficultyFactor) {
        // Pick spawn point along edges
        const side = Math.floor(Math.random() * 4);
        if (side === 0) { this.x = Math.random() * canvas.width; this.y = -20; }
        else if (side === 1) { this.x = canvas.width + 20; this.y = Math.random() * canvas.height; }
        else if (side === 2) { this.x = Math.random() * canvas.width; this.y = canvas.height + 20; }
        else { this.x = -20; this.y = Math.random() * canvas.height; }

        this.type = enemyTypes[Math.floor(Math.random() * enemyTypes.length)];
        this.counterSpell = spellData[this.type].counterSpell;
        
        // The word represents the counter-spell needed to defeat this enemy.
        // As game time increases, hard words spawn more frequently.
        const useHardWords = Math.random() < Math.min(difficultyFactor * 0.15, 0.85);
        const pool = useHardWords ? spellData[this.counterSpell].hard : spellData[this.counterSpell].easy;
        
        this.word = pool[Math.floor(Math.random() * pool.length)];
        this.typeIndex = 0;
        
        // Speed scales up gradually with difficulty
        this.speed = (0.5 + Math.random() * 0.3) + (difficultyFactor * 0.08);
        this.radius = 18;
        this.color = spellData[this.type].color;
    }

    // Move toward the wizard at a frame-rate-independent speed.
    update(frameDelta) {
        const angle = Math.atan2(wizard.y - this.y, wizard.x - this.x);
        this.x += Math.cos(angle) * this.speed * frameDelta;
        this.y += Math.sin(angle) * this.speed * frameDelta;

        const dist = Math.hypot(wizard.x - this.x, wizard.y - this.y);
        if (dist < wizard.radius + this.radius) {
            triggerGameOver();
        }
    }

    // Draw the enemy, its word, and the portion of the word already typed.
    draw() {
        const sprite = enemySprites[this.type];
        const isTargeted = currentTarget === this;

        if (sprite.complete && sprite.naturalWidth > 0) {
            ctx.drawImage(sprite, this.x - 32, this.y - 32, 64, 64);
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius + 2, 0, Math.PI * 2);
            ctx.lineWidth = isTargeted ? 3 : 1;
            ctx.strokeStyle = isTargeted ? '#ffffff' : '#000000';
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.fill();
            ctx.lineWidth = isTargeted ? 3 : 1;
            ctx.strokeStyle = isTargeted ? '#ffffff' : '#000000';
            ctx.stroke();
        }

        ctx.font = 'bold 16px monospace';
        const typedText = this.word.substring(0, this.typeIndex);
        const remainingText = this.word.substring(this.typeIndex);

        const textY = this.y - 25;
        const typedWidth = ctx.measureText(typedText).width;
        const totalWidth = ctx.measureText(this.word).width;
        const startX = this.x - (totalWidth / 2);

        ctx.textAlign = 'left';
        ctx.fillStyle = '#2ecc71';
        ctx.fillText(typedText, startX, textY);

        ctx.fillStyle = '#ffffff';
        ctx.fillText(remainingText, startX + typedWidth, textY);
    }

    // Advance this enemy's word when the typed character is correct.
    checkNextChar(char) {
        if (this.word[this.typeIndex] === char) {
            this.typeIndex++;
            return true;
        }
        return false;
    }

    // Report whether the player has typed the enemy's full word.
    isComplete() {
        return this.typeIndex >= this.word.length;
    }
}

// Initial UI Setup
document.getElementById('startHighScore').innerText = highScore;

// Reset the run, hide the menus, and begin the animation loop.
function startGame() {
    initializeAudio();
    startBackgroundMusic();
    gameState = 'PLAYING';
    score = 0;
    activeEnemies = [];
    currentTarget = null;
    spawnTimer = 0;
    lastFrameTime = 0;
    spellEffects = [];
    startTime = Date.now();

    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
    document.getElementById('pauseButton').classList.remove('hidden');
    document.getElementById('pauseScreen').classList.add('hidden');

    requestAnimationFrame(gameLoop);
}

/*
 * QUICK REFERENCE - WHERE TO MAKE CHANGES
 *
 * Want to change...                  Edit...
 * - Words or spell colors             spellData near the top
 * - Enemy counter-spells              counterSpell in spellData
 * - Enemy size or speed               Enemy.constructor()
 * - Collision behavior                Enemy.update()
 * - Enemy appearance                 Enemy.draw()
 * - Points for typing or defeating    keyboard handler
 * - Typing key sound                 playTypingSound()
 * - Background music                 startBackgroundMusic(), playMusicNote()
 * - Spell shot appearance             fireSpellBolt(), updateAndDrawSpellEffects()
 * - Spell projectile shapes           drawSpellProjectile()
 * - Defeat sound style per element    playDefeatSound()
 * - Spawn rate or difficulty          gameLoop()
 * - Full-screen game area             resizeCanvas(), index.css
 * - Opening screen artwork            start-bg.svg, index.css
 * - Battleground artwork              map1.svg, index.css
 * - Mage artwork and facing           mage.svg, drawWizard()
 * - Pause, resume, or quit behavior   pauseGame(), resumeGame(), quitToStart()
 * - End-of-game screen or high score  triggerGameOver()
 * - Menus and button text             index.html
 * - Layout and visual styling         index.css
 *
 * Fast mental model:
 * data -> Enemy -> keyboard input -> score/sound -> gameLoop -> canvas.
 */

// Create or resume the browser audio system after a user interaction.
function initializeAudio() {
    if (!audioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        audioContext = new AudioContextClass();
    }

    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
}

// Start a quiet looping melody made from short retro synth notes.
function startBackgroundMusic() {
    if (!audioContext || musicTimer) return;

    musicGain = audioContext.createGain();
    musicGain.gain.setValueAtTime(0.18, audioContext.currentTime);
    musicGain.connect(audioContext.destination);
    musicStep = 0;
    playMusicNote();
    musicTimer = setInterval(playMusicNote, 260);
}

// Play the next note in the repeating minor-style melody.
function playMusicNote() {
    if (!audioContext || !musicGain) return;

    const melody = [196, 233, 261, 311, 349, 311, 261, 233];
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const noteGain = audioContext.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(melody[musicStep], now);
    noteGain.gain.setValueAtTime(0.0001, now);
    noteGain.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
    noteGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    oscillator.connect(noteGain);
    noteGain.connect(musicGain);
    oscillator.start(now);
    oscillator.stop(now + 0.23);
    musicStep = (musicStep + 1) % melody.length;
}

// Lower the melody volume without stopping its sequence during a pause.
function pauseBackgroundMusic() {
    if (!musicGain || !audioContext) return;
    musicGain.gain.cancelScheduledValues(audioContext.currentTime);
    musicGain.gain.linearRampToValueAtTime(0.0001, audioContext.currentTime + 0.12);
}

// Restore the melody volume when the game resumes.
function resumeBackgroundMusic() {
    if (!musicGain || !audioContext) return;
    musicGain.gain.cancelScheduledValues(audioContext.currentTime);
    musicGain.gain.linearRampToValueAtTime(0.18, audioContext.currentTime + 0.12);
}

// Stop the melody and release its timer and audio node.
function stopBackgroundMusic() {
    if (musicTimer) {
        clearInterval(musicTimer);
        musicTimer = null;
    }

    if (musicGain) {
        musicGain.disconnect();
        musicGain = null;
    }
}

// Play a short mechanical keyboard click for a correctly typed letter.
function playTypingSound() {
    if (!audioContext) return;

    const now = audioContext.currentTime;
    const duration = 0.045;
    const sampleRate = audioContext.sampleRate;
    const buffer = audioContext.createBuffer(1, sampleRate * duration, sampleRate);
    const samples = buffer.getChannelData(0);
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();

    for (let index = 0; index < samples.length; index++) {
        samples[index] = (Math.random() * 2 - 1) * Math.exp(-index / (sampleRate * 0.012));
    }

    source.buffer = buffer;
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1200, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);
    source.start(now);
    source.stop(now + duration);
}

// Create a short colored bolt from the wizard to the enemy being typed.
function fireSpellBolt(enemy) {
    const spellColor = spellData[enemy.counterSpell].color;

    spellEffects.push({
        enemy,
        spellType: enemy.counterSpell,
        startX: wizard.x,
        startY: wizard.y,
        progress: 0,
        color: spellColor
    });
}

// Draw a recognizable pixel-style projectile for the selected counter-spell.
function drawSpellProjectile(type, x, y, color) {
    ctx.fillStyle = color;

    if (type === 'fire') {
        ctx.fillRect(x - 5, y - 8, 10, 16);
        ctx.fillRect(x - 8, y - 3, 16, 7);
        ctx.fillStyle = '#fff2c2';
        ctx.fillRect(x - 2, y - 4, 4, 8);
    } else if (type === 'ice') {
        ctx.beginPath();
        ctx.moveTo(x, y - 9);
        ctx.lineTo(x + 9, y);
        ctx.lineTo(x, y + 9);
        ctx.lineTo(x - 9, y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 2, y - 5, 4, 10);
    } else if (type === 'lightning') {
        ctx.fillRect(x - 3, y - 10, 7, 9);
        ctx.fillRect(x - 8, y - 2, 10, 6);
        ctx.fillRect(x - 3, y + 2, 7, 10);
    } else {
        ctx.fillRect(x - 3, y - 10, 6, 20);
        ctx.fillRect(x - 10, y - 3, 20, 6);
        ctx.fillStyle = '#fff7b2';
        ctx.fillRect(x - 2, y - 5, 4, 10);
    }
}

// Move each spell bolt toward its target and remove it after it lands.
function updateAndDrawSpellEffects(frameDelta) {
    spellEffects = spellEffects.filter(effect => {
        effect.progress += frameDelta * 0.16;
        const targetX = effect.enemy.x;
        const targetY = effect.enemy.y;
        const boltX = effect.startX + (targetX - effect.startX) * effect.progress;
        const boltY = effect.startY + (targetY - effect.startY) * effect.progress;

        ctx.save();
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 4;
        ctx.shadowColor = effect.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(effect.startX, effect.startY);
        ctx.lineTo(boltX, boltY);
        ctx.stroke();
        drawSpellProjectile(effect.spellType, boltX, boltY, effect.color);
        ctx.restore();

        return effect.progress < 1;
    });
}

// Play a short sound whose tone matches the defeated enemy's element.
function playDefeatSound(type) {
    if (!audioContext) return;

    const soundSettings = {
        fire: { waveform: 'sawtooth', startFrequency: 220, endFrequency: 70, duration: 0.2 },
        ice: { waveform: 'sine', startFrequency: 660, endFrequency: 990, duration: 0.3 },
        lightning: { waveform: 'square', startFrequency: 1200, endFrequency: 160, duration: 0.14 },
        holy: { waveform: 'triangle', startFrequency: 440, endFrequency: 880, duration: 0.35 }
    }[type];

    if (!soundSettings) return;

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = soundSettings.waveform;
    oscillator.frequency.setValueAtTime(soundSettings.startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(soundSettings.endFrequency, now + soundSettings.duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + soundSettings.duration);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + soundSettings.duration);
}

// Freeze the game and show the pause menu without destroying the current run.
function pauseGame() {
    if (gameState !== 'PLAYING') return;

    gameState = 'PAUSED';
    pauseBackgroundMusic();
    pauseStartedAt = Date.now();
    document.getElementById('pauseButton').classList.add('hidden');
    document.getElementById('pauseScreen').classList.remove('hidden');
}

// Show the three-second countdown, then continue the frozen run.
function resumeGame() {
    if (gameState !== 'PAUSED') return;

    gameState = 'COUNTDOWN';
    let secondsRemaining = 3;
    const countdownText = document.getElementById('countdownText');
    countdownText.innerText = secondsRemaining;

    countdownTimer = setInterval(() => {
        secondsRemaining--;
        countdownText.innerText = secondsRemaining > 0 ? secondsRemaining : 'GO!';

        if (secondsRemaining <= 0) {
            clearInterval(countdownTimer);
            countdownTimer = null;
            startTime += Date.now() - pauseStartedAt;
            gameState = 'PLAYING';
            resumeBackgroundMusic();
            document.getElementById('pauseScreen').classList.add('hidden');
            document.getElementById('pauseButton').classList.remove('hidden');
            requestAnimationFrame(gameLoop);
        }
    }, 1000);
}

// Discard the current run and return to the opening screen.
function quitToStart() {
    if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }

    gameState = 'START';
    stopBackgroundMusic();
    activeEnemies = [];
    currentTarget = null;
    score = 0;
    spellEffects = [];

    document.getElementById('pauseButton').classList.add('hidden');
    document.getElementById('pauseScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
}

// Stop the run, save a new high score if needed, and show the results screen.
function triggerGameOver() {
    gameState = 'GAMEOVER';
    stopBackgroundMusic();
    elapsedTime = Math.floor((Date.now() - startTime) / 1000);

    if (score > highScore) {
        highScore = score;
        localStorage.setItem('wizard_highscore', highScore);
    }

    document.getElementById('finalScore').innerText = score;
    document.getElementById('finalTime').innerText = elapsedTime + "s";
    document.getElementById('endHighScore').innerText = highScore;
    document.getElementById('startHighScore').innerText = highScore;

    document.getElementById('gameOverScreen').classList.remove('hidden');
}

// Route Escape to pause/resume, then use typed letters to attack enemies.
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (gameState === 'PLAYING') pauseGame();
        else if (gameState === 'PAUSED') resumeGame();
        return;
    }

    if (gameState !== 'PLAYING') return;

    const char = e.key.toLowerCase();
    if (char.length !== 1 || char < 'a' || char > 'z') return;

    if (currentTarget) {
        if (currentTarget.checkNextChar(char)) {
            fireSpellBolt(currentTarget);
            playTypingSound();
            score += 10; // Points per correct letter
            if (currentTarget.isComplete()) {
                score += currentTarget.word.length * 25; // Bonus points for completing a word
                playDefeatSound(currentTarget.counterSpell);
                activeEnemies = activeEnemies.filter(e => e !== currentTarget);
                currentTarget = null;
            }
        }
    } else {
        let matchingEnemies = activeEnemies.filter(e => e.word.startsWith(char));
        if (matchingEnemies.length > 0) {
            matchingEnemies.sort((a, b) => {
                const distA = Math.hypot(wizard.x - a.x, wizard.y - a.y);
                const distB = Math.hypot(wizard.x - b.x, wizard.y - b.y);
                return distA - distB;
            });
            currentTarget = matchingEnemies[0];
            currentTarget.checkNextChar(char);
            fireSpellBolt(currentTarget);
            playTypingSound();
            score += 10;
        }
    }
});

// Run one time-adjusted frame of gameplay, then schedule the next frame.
function gameLoop(timestamp) {
    if (gameState !== 'PLAYING') return;

    if (lastFrameTime === 0) lastFrameTime = timestamp;
    const frameDelta = Math.min((timestamp - lastFrameTime) / 16.6667, 2);
    lastFrameTime = timestamp;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Difficulty Factor increases by 1 point every 10 seconds survived
    const difficultyFactor = (Date.now() - startTime) / 10000;

    // Spawning Logic (Spawn rate speeds up over time, capped at 0.6 seconds minimum)
    const currentSpawnInterval = Math.max(35, baseSpawnInterval - (difficultyFactor * 12));
    spawnTimer += frameDelta;
    if (spawnTimer >= currentSpawnInterval) {
        activeEnemies.push(new Enemy(difficultyFactor));
        spawnTimer = 0;
    }

    // Update & Draw Enemies
    activeEnemies.forEach(enemy => {
        enemy.update(frameDelta);
        enemy.draw();
    });

    updateAndDrawSpellEffects(frameDelta);

    // Draw the mage facing the active target.
    drawWizard();

    // Draw In-Game HUD
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE: ${score}`, 20, 35);

    ctx.fillStyle = '#f1c40f';
    ctx.fillText(`HIGH: ${highScore}`, 20, 60);

    const currentTime = Math.floor((Date.now() - startTime) / 1000);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText(`TIME: ${currentTime}s`, canvas.width - 20, 35);

    requestAnimationFrame(gameLoop);
}
