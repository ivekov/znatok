// Particle System for Modern Background
class ParticleSystem {
    constructor() {
        this.particles = [];
        this.container = document.getElementById('particles');
        this.init();
    }

    init() {
        this.createParticles();
        this.animate();
    }

    createParticles() {
        const particleCount = window.innerWidth < 768 ? 30 : 50;
        
        for (let i = 0; i < particleCount; i++) {
            this.createParticle();
        }
    }

    createParticle() {
        const particle = document.createElement('div');
        particle.className = 'particle';
        
        // Random properties
        const size = Math.random() * 3 + 1;
        const posX = Math.random() * 100;
        const delay = Math.random() * 20;
        const duration = 15 + Math.random() * 15;
        
        particle.style.cssText = `
            width: ${size}px;
            height: ${size}px;
            left: ${posX}vw;
            animation-delay: ${delay}s;
            animation-duration: ${duration}s;
            background: rgba(${Math.random() * 255}, ${Math.random() * 255}, ${Math.random() * 255}, ${Math.random() * 0.3 + 0.1});
        `;
        
        this.container.appendChild(particle);
        this.particles.push(particle);
    }

    animate() {
        // Additional animation logic can go here
    }
}

// Initialize particle system
document.addEventListener('DOMContentLoaded', () => {
    new ParticleSystem();
});