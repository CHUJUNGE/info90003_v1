// Import THREE if using modules and a local Three.js copy, or rely on global THREE from CDN
// import * as THREE from 'three'; // Example if using npm/modules

let scene, camera, renderer, particleSystem; // Renamed globe to particleSystem for clarity
const particleCount = 5000; // Number of particles for the globe
let particleAttributes; // To store attributes like velocity, lifetime

function init() {
    // Scene setup
    scene = new THREE.Scene();

    // Camera setup
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 4; 

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    
    const sceneContainer = document.querySelector('.scene-container');
    if (sceneContainer) {
        sceneContainer.appendChild(renderer.domElement);
    } else {
        console.error('Scene container not found!');
        document.body.appendChild(renderer.domElement); 
    }

    // Particle system geometry and material
    const particles = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const opacities = new Float32Array(particleCount); // Store opacity per particle
    const sizes = new Float32Array(particleCount);

    const radius = 1.6;
    const baseColor = new THREE.Color(0xAACCEE); // Light sky blue

    for (let i = 0; i < particleCount; i++) {
        // Spherical coordinates to distribute points on a sphere
        const phi = Math.acos(-1 + (2 * i) / particleCount); // Distribute more evenly than random
        const theta = Math.sqrt(particleCount * Math.PI) * phi;

        const x = radius * Math.sin(phi) * Math.cos(theta);
        const y = radius * Math.sin(phi) * Math.sin(theta);
        const z = radius * Math.cos(phi);

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        colors[i * 3] = baseColor.r;
        colors[i * 3 + 1] = baseColor.g;
        colors[i * 3 + 2] = baseColor.b;

        // Initial velocities (normalized direction from center, scaled later)
        const vec = new THREE.Vector3(x, y, z).normalize();
        velocities[i * 3] = vec.x;
        velocities[i * 3 + 1] = vec.y;
        velocities[i * 3 + 2] = vec.z;

        opacities[i] = 1.0;
        sizes[i] = Math.random() * 0.05 + 0.02; // Random sizes for variety
    }

    particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particles.setAttribute('color', new THREE.BufferAttribute(colors, 3)); // Enable vertex colors
    particles.setAttribute('customVelocity', new THREE.BufferAttribute(velocities, 3));
    particles.setAttribute('customOpacity', new THREE.BufferAttribute(opacities, 1));
    particles.setAttribute('customSize', new THREE.BufferAttribute(sizes, 1));

    const particleMaterial = new THREE.PointsMaterial({
        size: 0.03, // Base size, can be modulated by customSize if shader is used
        vertexColors: true, // Use colors from geometry attributes
        transparent: true,
        opacity: 0.6, // Global opacity, individual particle opacity is handled in animate
        sizeAttenuation: true // Points get smaller further away
    });

    particleSystem = new THREE.Points(particles, particleMaterial);
    scene.add(particleSystem);

    // Store attributes for animation
    particleAttributes = {
        positions: particleSystem.geometry.attributes.position,
        velocities: particleSystem.geometry.attributes.customVelocity,
        opacities: particleSystem.geometry.attributes.customOpacity,
        initialPositions: new Float32Array(positions) // Keep a copy of initial positions for reset if needed
    };

    // Properties for dissipation
    particleSystem.isDissipating = false;
    particleSystem.dissipationSpeedFactor = 0.03; // How fast particles move outwards
    particleSystem.opacityFadeSpeed = 0.015; // How fast particles fade

    // Dissipate method for the particle system
    particleSystem.dissipate = function() {
        this.isDissipating = true;
        // Reset opacities to 1 for all particles at the start of dissipation
        // This is important if dissipation can be triggered multiple times or after a partial fade
        const opacitiesAttr = this.geometry.attributes.customOpacity;
        for (let i = 0; i < particleCount; i++) {
            opacitiesAttr.array[i] = 1.0;
        }
        opacitiesAttr.needsUpdate = true;
        console.log('Particle system dissipation initiated.');
    };

    // Expose particleSystem to the window object
    window.currentGlobe = particleSystem; // Keep window.currentGlobe for compatibility with index.html

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Start animation
    animate();

    // Fullscreen button logic (remains the same)
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', toggleFullScreen);
        document.addEventListener('fullscreenchange', () => {
            if (document.fullscreenElement) {
                document.documentElement.classList.add('fullscreen-active');
                fullscreenBtn.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16h3m11 0h3M16 5h3M5 8V5M19 8V5M8 19v-3M16 19v-3"></path></svg>`;
            } else {
                document.documentElement.classList.remove('fullscreen-active');
                fullscreenBtn.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>`;
            }
        });
    }
}

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            alert(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    if (particleSystem) {
        if (particleSystem.isDissipating) {
            let allFaded = true;
            const positions = particleAttributes.positions.array;
            const velocities = particleAttributes.velocities.array;
            const opacities = particleAttributes.opacities.array;
            
            for (let i = 0; i < particleCount; i++) {
                if (opacities[i] > 0) {
                    // Update position
                    positions[i * 3] += velocities[i * 3] * particleSystem.dissipationSpeedFactor;
                    positions[i * 3 + 1] += velocities[i * 3 + 1] * particleSystem.dissipationSpeedFactor;
                    positions[i * 3 + 2] += velocities[i * 3 + 2] * particleSystem.dissipationSpeedFactor;
                    
                    // Update opacity
                    opacities[i] -= particleSystem.opacityFadeSpeed;
                    if (opacities[i] < 0) opacities[i] = 0;
                    allFaded = false;
                }
            }
            particleAttributes.positions.needsUpdate = true;
            particleAttributes.opacities.needsUpdate = true; // This is key for PointsMaterial to see opacity changes
            
            // Update the opacity of the material for each particle (requires custom shader or iterating attributes)
            // For now, we are controlling opacity via vertex attributes. 
            // If PointsMaterial's global opacity is used, it will fade all points uniformly.
            // To make individual particle opacity work without a custom shader, 
            // we might need to adjust color alpha if vertexColors include alpha, or manage visibility.
            // The current setup relies on hoping the renderer picks up opacity from color alpha if vertexColors is RGBA.
            // A more robust way for individual opacity with PointsMaterial is a custom shader or modifying alpha in vertex colors.
            // Let's assume for now that updating the 'customOpacity' attribute and `vertexColors: true` is enough
            // or that we will primarily see the effect through particles moving and eventually disappearing.
            // A simple hack for PointsMaterial without custom shader is to set point size to 0 when opacity is 0.
            // Or, more directly, if colors attribute included alpha:
            // particleSystem.geometry.attributes.color.array[i*4+3] = opacities[i];
            // particleSystem.geometry.attributes.color.needsUpdate = true;

            if (allFaded) {
                console.log('Globe: All particles faded.'); // ADDED LOG
                particleSystem.visible = false; // UNCOMMENTED: Optionally hide the whole system
                particleSystem.isDissipating = false; // UNCOMMENTED: Reset state if needed
                // Consider resetting particle positions if dissipation might be re-triggered
            }
        } else if (particleSystem.visible) { // Only rotate if not dissipating and visible
            particleSystem.rotation.x += 0.001;
            particleSystem.rotation.y += 0.002;
        }
    }

    renderer.render(scene, camera);
}

// Initialize Three.js scene on load
init();
