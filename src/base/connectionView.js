/**
 *
 *  Copyright 2016 Netflix, Inc.
 *
 *     Licensed under the Apache License, Version 2.0 (the "License");
 *     you may not use this file except in compliance with the License.
 *     You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 *     Unless required by applicable law or agreed to in writing, software
 *     distributed under the License is distributed on an "AS IS" BASIS,
 *     WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *     See the License for the specific language governing permissions and
 *     limitations under the License.
 *
 */
import { knuthShuffle as shuffle } from 'knuth-shuffle';
import * as THREE from 'three';

import BaseView from './baseView';
import ConnectionNoticeView from './connectionNoticeView';
import GlobalStyles from '../globalStyles';
import Constants from './constants';



// Preload textures
const loader = new THREE.TextureLoader();

// Preload the particle texture
const particle = require('url!./particleD.png'); // eslint-disable-line import/no-extraneous-dependencies

let particleTexture;
loader.load(particle, texture => { particleTexture = texture; });


let totalParticles = 0;
let particlesInFlight = 0;

let reportObj = {};


function report(){
  console.log(`total ${totalParticles} particles, ${particlesInFlight} in flight`);
  console.log(reportObj);
  setTimeout(report, 1000);
};
report();

const trafficFragmentShader = `
uniform vec3 color;
uniform sampler2D texture;

varying float vCustomOpacity;
varying float vOpacity;
varying vec3 vColor;

void main() {

  gl_FragColor = vec4( color * vColor, vOpacity * vCustomOpacity );
  gl_FragColor = gl_FragColor * texture2D( texture, gl_PointCoord );

}
`;

const trafficVertexShader = `
uniform float opacity;
uniform float amplitude;

attribute float customOpacity;
attribute float size;
attribute vec3 customColor;

varying float vCustomOpacity;
varying float vOpacity;
varying vec3 vColor;

void main() {
  vColor = customColor;
  vOpacity = opacity;
  vCustomOpacity = customOpacity;

  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_PointSize = size;
  gl_Position = projectionMatrix * mvPosition;
}
`;


const baseShaderMaterial = new THREE.ShaderMaterial({
  uniforms: {},
  vertexShader: trafficVertexShader,
  fragmentShader: trafficFragmentShader,
  blending: THREE.NormalBlending,
  depthTest: true,
  depthWrite: false,
  transparent: true
});

function normalDistribution () {
  return (((Math.random() + Math.random() + Math.random() + Math.random() + Math.random() + Math.random()) - 3) / 3) + 0.5;
}

function interpolateValue (val, aMin, aMax, bMin, bMax) {
  const mappedValue = ((val - aMin) / (aMax - aMin)) * (bMax - bMin);
  return bMin + (mappedValue || 0);
}

function generateParticleSystem(size, customWidth, connectionWidth, connectionDepth){
    const vertices = new Float32Array(size * 3);
    const customColors = new Float32Array(size * 3);
    const customOpacities = new Float32Array(size);
    const sizes = new Float32Array(size);
    const velocities = new Float32Array(size * 3); // Don't want to to be doing math in the update loop

    for (let i = 0; i < size; i++) {
      // Position
      vertices[i * 3] = 0;
      vertices[(i * 3) + 1] = customWidth ? connectionWidth - (normalDistribution() * connectionWidth * 2) : 1;
      vertices[(i * 3) + 2] = customWidth ? connectionDepth - (normalDistribution() * connectionDepth * 2) : -2;

      // Custom colors
      customColors[i] = GlobalStyles.threeStyles.colorTraffic.normal.r;
      customColors[i + 1] = GlobalStyles.threeStyles.colorTraffic.normal.g;
      customColors[i + 2] = GlobalStyles.threeStyles.colorTraffic.normal.b;

      customOpacities[i] = 0;
      sizes[i] = 6;
      velocities[i * 3] = 3 + (Math.random() * 2);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.addAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.addAttribute('customColor', new THREE.BufferAttribute(customColors, 3));
    geometry.addAttribute('customOpacity', new THREE.BufferAttribute(customOpacities, 1));
    geometry.addAttribute('size', new THREE.BufferAttribute(sizes, 1));

    return {
      geometry: geometry,
      velocities: velocities
    }
}


function copyArray(destination, source){
  for(let i = 0; i < source.length && i < destination.length; i++){
    destination[i] = source[i];
  }
}

function copyParticleSystemState(oldPs, newPs){
  let positionAttr = newPs.geometry.getAttribute('position');
  copyArray(positionAttr, oldPs.geometry.getAttribute('position'))
  positionAttr.needsUpdate = true;

  let opacityAttr = newPs.geometry.getAttribute('customOpacity');
  copyArray(opacityAttr, oldPs.geometry.getAttribute('customOpacity'))
  opacityAttr.needsUpdate = true;
}

class ConnectionView extends BaseView {
  constructor (connection, maxParticles, customWidth) {
    super(connection);
    this.setParticleLevels();
    this.maxParticles = maxParticles;
    this.dimmedLevel = 0.05;

    this.centerVector = new THREE.Vector3(0, 0, 0);
    this.length = 0;

    this.particlesInFlight = 0;
    this.particleSize = this.maxParticles;


    this.uniforms = {
      amplitude: { type: 'f', value: 1.0 },
      color: { type: 'c', value: new THREE.Color(0xFFFFFF) },
      opacity: { type: 'f', value: 1.0 },
      texture: { type: 't', value: particleTexture, transparent: true }
    };

    this.shaderMaterial = baseShaderMaterial.clone();
    this.shaderMaterial.uniforms = this.uniforms;

    this.customWidth = customWidth;
    this.connectionWidth = Math.min(this.object.source.getView().radius, this.object.target.getView().radius) * 0.45;
    this.connectionDepth = Math.min(connection.source.getView().getDepth(), (connection.target.getView().getDepth()) / 2) - 2;


    this.lastParticleIndex = 0;
    this.particleLaunchDelay = Infinity;

    totalParticles += this.maxParticles;


    let ps = generateParticleSystem(this.maxParticles, this.customWidth, this.connectionWidth, this.connectionDepth);

    this.velocity = ps.velocities;
    this.particles = new THREE.Points(ps.geometry, this.shaderMaterial);
    this.positionAttr = this.particles.geometry.getAttribute('position');
    this.opacityAttr = this.particles.geometry.getAttribute('customOpacity');
    this.container.add(this.particles);



    // TODO: Use a THREE.Line and THREE.LineBasicMaterial with linewidth for the interactive object...
    // Line used to support interactivity
    this.interactiveLineGeometry = new THREE.Geometry();
    this.interactiveLineMaterial = new THREE.LineBasicMaterial({
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0
    });
    this.interactiveLine = new THREE.Line(this.interactiveLineGeometry, this.interactiveLineMaterial);
    this.addInteractiveChild(this.interactiveLine);
    this.container.add(this.interactiveLine);

    // Add the connection notice
    this.noticeView = new ConnectionNoticeView(this);
    this.validateNotices();
  }

  setParticleLevels () {
    this.minParticlesPerRelease = 0.002; //TODO: set this to a good number!!!
  }


  setOpacity (opacity) {
    super.setOpacity(opacity);
    this.uniforms.opacity.value = opacity;

    if (this.object.hasNotices()) {
      this.noticeView.setOpacity(opacity);
    }
  }

  setHighlight (highlight) {
    // TODO: Actually highlight the connection
    if (this.highlight !== highlight) {
      this.highlight = highlight;
      // this.refresh(true);
      // this.updatePosition();
    }
  }

  updatePosition (depthOnly) {
    this.depth = this.dimmed ? Constants.DEPTH.dimmedConnection : Constants.DEPTH.normalConnection;

    // Position and rotate the connection to be between the two nodes
    this.startPosition = this.object.source.getView().container.position;
    this.endPosition = this.object.target.getView().container.position;
    const start = new THREE.Vector3(this.startPosition.x, this.startPosition.y, this.depth);
    this.particles.position.set(start.x, start.y, start.z);

    if (!depthOnly) {
      // particles
      const centerX = (this.startPosition.x + this.endPosition.x) / 2;
      const centerY = (this.startPosition.y + this.endPosition.y) / 2;
      this.centerVector = new THREE.Vector3(centerX, centerY, this.depth);
      const end = new THREE.Vector3(this.endPosition.x, this.endPosition.y, this.depth);
      const direction = new THREE.Vector3().copy(end).sub(start).normalize();
      this.particles.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction);

      // update length to know how far particles are to travel
      this.length = start.distanceTo(end);

      // interactivity
      this.interactiveLine.geometry.vertices[0] = start;
      this.interactiveLine.geometry.vertices[1] = end;
      this.interactiveLine.geometry.verticesNeedUpdate = true;
      this.interactiveLine.geometry.computeBoundingSphere();
    }

    if (this.noticeView) {
      this.noticeView.updatePosition();
    }
  }

  validateNotices () {
    if (this.object.hasNotices()) {
      this.noticeView.updateNoticeIcon();
      this.addInteractiveChildren(this.noticeView.getInteractiveChildren());
      this.container.add(this.noticeView.container);
    } else {
      this.removeInteractiveChildren(this.noticeView.getInteractiveChildren());
      this.container.remove(this.noticeView.container);
    }
  }

  updateVolume () {
  }

  launchParticles (numberOfParticles, key, startX) {
    let rand; // eslint-disable-line prefer-const
    let i;
    numberOfParticles = numberOfParticles || 1;
    startX = startX || 0;

    particlesInFlight += numberOfParticles;

    this.particlesInFlight += numberOfParticles;
    if(this.particlesInFlight > this.particleSize){

    }

    for (i = 0; i < numberOfParticles; i++) {
      rand = Math.random();
      // Get/set the x position for the last particle index
      this.positionAttr.setX(this.lastParticleIndex, startX + rand);
      this.positionAttr.needsUpdate = true;

      this.opacityAttr.array[this.lastParticleIndex] = 1.0;
      this.opacityAttr.needsUpdate = true;

      let color = GlobalStyles.getColorTrafficThree(key);
      this.setParticleColor(this.lastParticleIndex, color);

      this.lastParticleIndex++;
      if (this.lastParticleIndex === this.maxParticles) {
        this.lastParticleIndex = 0;
      }
    }
  }

  update (currentTime) {
    let vx;
    let i;

    // We need the highest RPS connection to make this volume relative against
    if (!this.object.volumeGreatest) { return; }

    const maxParticleReleasedPerTick = 19;
    let particlesPerRps = maxParticleReleasedPerTick / this.object.volumeGreatest;

    //for each volume, calculate the amount of particles to release:
    for(let volumeName in this.object.volume){
      if(this.object.volume.hasOwnProperty(volumeName)){
        let volume = this.object.volume[volumeName];

        if(!volume){ //zero is zero, NaN is ignored.
          continue;
        }

        const particlesToRelease =  Math.max(particlesPerRps * volume, this.minParticlesPerRelease);

        let wholeParticles = Math.floor(particlesToRelease);
        //if we should only release 0.1 particles per release, pick a random number and if it is below that amount, release a particle.
        //  so, the average particles per release should even out.
        if(Math.random() < (particlesToRelease - wholeParticles)){
          wholeParticles += 1;
        }

        if(wholeParticles > 0){
          this.launchParticles(wholeParticles, volumeName);  
        }
      }
    }

    // TODO: Support a deltaX based on last time updated.  We tried this, and
    //       because of weird rendering buffers in THREE, the animation hiccups
    //       made doing it this way MUCH worse.  Keeping it as is until we can
    //       attack the issue with THREE...

    // Update the position of all particles in flight
    for (i = 0; i < this.positionAttr.array.length; i += 3) {
      vx = this.positionAttr.array[i];

      if (vx !== 0) {
        vx += this.velocity[i];
        if (vx >= this.length) {
          particlesInFlight -= 1;
          vx = 0;
        }
      }
      this.positionAttr.array[i] = vx;
    }
    this.positionAttr.needsUpdate = true;
  }

  refresh () {
    this.validateNotices();
  }

  setParticleColor (index, color) {
    const colorAttr = this.particles.geometry.getAttribute('customColor');
    colorAttr.setXYZ(index, color.r, color.g, color.b);
    colorAttr.needsUpdate = true;

    const opacity = this.particles.geometry.getAttribute('customOpacity');
    opacity.setX(index, color.a);
    opacity.needsUpdate = true;
  }

  setParticleSize (index, size) {
    const sizeAttribute = this.particles.geometry.getAttribute('size');
    if (sizeAttribute) {
      sizeAttribute.setX(index, size);
      sizeAttribute.needsUpdate = true;
    }
  }

  cleanup () {
    this.geometry.dispose();
    this.shaderMaterial.dispose();
    this.interactiveLineGeometry.dispose();
    this.interactiveLineMaterial.dispose();
  }
}

export default ConnectionView;
