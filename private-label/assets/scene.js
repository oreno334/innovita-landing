/* Innovita private-label studio. All artwork and lighting are generated locally.
 * Requires the self-hosted Three.js r160 global; never requests remote resources.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    logo: null, productName: 'Daily essentials', accent: '#2c707a',
    bottleFinish: 'amber', capFinish: 'ivory', labelStyle: 'signature',
    logoScale: 1, logoOffsetY: 0,
    packagingColor: '#f3f0e8', labelColor: '#f3f0e8', capColor: '#e6e3d6',
    bottleColor: '#f2f0e8', surfaceFinish: 'matte',
  };
  var CREAM = '#f3f0e8';
  var INK = '#183347';
  var clamp = function (value, min, max) { return Math.max(min, Math.min(max, value)); };

  function normalize(input, previous) {
    var next = Object.assign({}, previous || DEFAULTS, input || {});
    next.productName = String(next.productName || DEFAULTS.productName).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 90) || DEFAULTS.productName;
    next.accent = /^#[\da-f]{6}$/i.test(next.accent) ? next.accent : DEFAULTS.accent;
    next.bottleFinish = ['amber', 'white', 'custom'].indexOf(next.bottleFinish) >= 0 ? next.bottleFinish : 'amber';
    next.capFinish = ['ivory', 'black', 'custom'].indexOf(next.capFinish) >= 0 ? next.capFinish : 'ivory';
    ['packagingColor', 'labelColor', 'capColor', 'bottleColor'].forEach(function (key) {
      next[key] = /^#[\da-f]{6}$/i.test(next[key]) ? next[key] : DEFAULTS[key];
    });
    next.surfaceFinish = next.surfaceFinish === 'satin' ? 'satin' : 'matte';
    next.labelStyle = next.labelStyle === 'minimal' ? 'minimal' : 'signature';
    next.logoScale = clamp(Number(next.logoScale) || 1, 0.65, 1.5);
    next.logoOffsetY = clamp(Number(next.logoOffsetY) || 0, -0.15, 0.15);
    return next;
  }

  function canvas(width, height) {
    var output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    return output;
  }

  function mixHex(first, second, amount) {
    var a = parseInt(first.slice(1), 16);
    var b = parseInt(second.slice(1), 16);
    var channels = [16, 8, 0].map(function (shift) {
      return Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount);
    });
    return '#' + channels.map(function (channel) { return channel.toString(16).padStart(2, '0'); }).join('');
  }

  function inkOn(color) {
    function luminance(hex) {
      var channels = [1, 3, 5].map(function (start) {
        var value = parseInt(hex.slice(start, start + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    }
    var light = luminance(color);
    var navyContrast = (Math.max(light, luminance(INK)) + 0.05) / (Math.min(light, luminance(INK)) + 0.05);
    var whiteContrast = 1.05 / (light + 0.05);
    if (navyContrast >= 4.5) return INK;
    if (whiteContrast >= 4.5) return '#ffffff';
    return '#000000';
  }

  function trackedText(ctx, text, centerX, y, tracking, font, color) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    var letters = Array.from(text);
    var width = letters.reduce(function (sum, letter) { return sum + ctx.measureText(letter).width; }, 0) + Math.max(0, letters.length - 1) * tracking;
    var x = centerX - width / 2;
    letters.forEach(function (letter) {
      ctx.fillText(letter, x, y);
      x += ctx.measureText(letter).width + tracking;
    });
  }

  function productText(ctx, text, centerX, topY, maxWidth, maxHeight, size, color) {
    var lines;
    var fontSize = size;
    do {
      ctx.font = '600 ' + fontSize + 'px Arial, sans-serif';
      lines = [];
      var line = '';
      text.split(/\s+/).forEach(function (word) {
        var candidate = line ? line + ' ' + word : word;
        if (line && ctx.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
        else line = candidate;
      });
      if (line) lines.push(line);
      if (lines.length * fontSize * 1.18 <= maxHeight && lines.every(function (item) { return ctx.measureText(item).width <= maxWidth; })) break;
      fontSize -= 2;
    } while (fontSize > 22);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = /[\u0590-\u08ff]/.test(text) ? 'rtl' : 'ltr';
    ctx.fillStyle = color || INK;
    var lineHeight = fontSize * 1.18;
    var firstY = topY + (maxHeight - lines.length * lineHeight) / 2 + lineHeight / 2;
    lines.forEach(function (line, index) { ctx.fillText(line, centerX, firstY + index * lineHeight, maxWidth); });
    ctx.direction = 'ltr';
    ctx.textBaseline = 'alphabetic';
  }

  function logo(ctx, design, centerX, centerY, width, height, limits) {
    limits = limits || {};
    var image = design.logo;
    var shiftedY = centerY + design.logoOffsetY * height;
    if (image && image.complete && image.naturalWidth && image.naturalHeight) {
      var factor = Math.min(width / image.naturalWidth, height / image.naturalHeight) * design.logoScale;
      var drawWidth = image.naturalWidth * factor;
      var drawHeight = image.naturalHeight * factor;
      if (limits.maxWidth && drawWidth > limits.maxWidth) {
        drawHeight *= limits.maxWidth / drawWidth;
        drawWidth = limits.maxWidth;
      }
      shiftedY = Math.max(shiftedY, (limits.top || 0) + drawHeight / 2);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // drawImage composites the original alpha channel over the paper; no
      // background replacement, silhouette cropping or aspect-ratio distortion.
      ctx.drawImage(image, centerX - drawWidth / 2, shiftedY - drawHeight / 2, drawWidth, drawHeight);
      return { bottom: shiftedY + drawHeight / 2 };
    } else {
      var size = width * 0.111 * design.logoScale;
      trackedText(ctx, 'YOUR BRAND', centerX, shiftedY + size * 0.34, size * 0.045, '600 ' + size + 'px Arial, sans-serif', limits.ink || INK);
      return { bottom: shiftedY + size * 0.45 };
    }
  }

  function create(options) {
    options = options || {};
    var mount = options.mount;
    var THREE = global.THREE;
    if (!mount || !mount.appendChild) throw new TypeError('InnovitaStudioScene requires a mount element.');
    if (!THREE || !THREE.WebGLRenderer) throw new Error('The local Three.js runtime is unavailable.');

    var design = normalize(options.design);
    var packaging = 'set';
    var view = 'angle';
    var yaw = -0.20;
    var cartonYaw = -0.07;
    var pitch = 0.17;
    var zoom = 1;
    var autoRotate = false;
    var orbitMode = false;
    var lastFrameTime = 0;
    var lastAutoEvent = 0;
    var motionQuery = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    var reduced = motionQuery.matches;
    var width = 1;
    var height = 1;
    var pixelRatio = 1;
    var disposed = false;
    var contextLost = false;
    var ready = false;
    var visible = true;
    var designDirty = true;
    var labelDirty = true;
    var cartonDirty = true;
    var needsFrame = true;
    var raf = 0;
    var exporting = false;
    var exportPromise = null;
    var renderer;
    var scene;
    var camera;
    var stage;
    var bottle;
    var carton;
    var bottleMaterial;
    var capMaterial;
    var ribMaterial;
    var labelMaterial;
    var cartonMaterial;
    var creaseMaterial;
    var bottleBounds;
    var cartonBounds;
    var labelTexture;
    var cartonTexture;
    var environmentTarget;
    var observer;
    var intersection;
    var pointer = null;
    var touches = new Map();
    var pinchDistance = 0;
    var renderCount = 0;
    var logoListener = null;
    var originalTouchAction = mount.style.touchAction;
    var originalCursor = mount.style.cursor;
    var resources = new Set();
    var removers = [];
    // Full-wrap bottle art has its seam at the back. Physical and bitmap aspect
    // ratios match, so a circular uploaded logo is never stretched by the canvas.
    var textureScale = 2;
    var labelLogicalHeight = Math.round(2048 * 1.96 / (Math.PI * 2 * 0.766));
    var labelCanvas;
    var cartonCanvas;
    // One atlas supplies every carton face and the bevels, with a small gutter.
    var faces = {
      front: { x: 16, y: 16, w: 710, h: 1537 },
      back: { x: 746, y: 16, w: 710, h: 1537 },
      side: { x: 1476, y: 16, w: 422, h: 1537 },
      top: { x: 16, y: 1582, w: 710, h: 422 },
      bottom: { x: 746, y: 1582, w: 710, h: 422 },
    };

    function track(value) { resources.add(value); return value; }
    function listen(node, name, fn, config) {
      node.addEventListener(name, fn, config);
      removers.push(function () { node.removeEventListener(name, fn, config); });
    }
    function mesh(geometry, material, parent) {
      var item = new THREE.Mesh(track(geometry), material);
      (parent || stage).add(item);
      return item;
    }
    function lathe(points, material, parent) {
      return mesh(new THREE.LatheGeometry(points.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), 128), material, parent);
    }
    function ring(radius, tube, y, material, parent) {
      var item = mesh(new THREE.TorusGeometry(radius, tube, 12, 128), material, parent);
      item.rotation.x = Math.PI / 2;
      item.position.y = y;
      return item;
    }
    function setMaterialColor(material, color) { material.color.set(color); }

    function environment() {
      var source = canvas(1024, 512);
      var ctx = source.getContext('2d');
      var gradient = ctx.createLinearGradient(0, 0, 0, 512);
      gradient.addColorStop(0, '#343b3b');
      gradient.addColorStop(0.38, '#bfc6c0');
      gradient.addColorStop(0.58, '#eff0e8');
      gradient.addColorStop(1, '#746f61');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1024, 512);
      [[80, 145], [470, 245], [875, 65]].forEach(function (box) {
        var light = ctx.createLinearGradient(box[0], 0, box[0] + box[1], 0);
        light.addColorStop(0, 'rgba(255,255,255,0)');
        light.addColorStop(0.2, 'rgba(255,255,249,1)');
        light.addColorStop(0.8, 'rgba(255,255,249,1)');
        light.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = light;
        ctx.fillRect(box[0], 48, box[1], 335);
      });
      ctx.fillStyle = '#313e3d';
      ctx.fillRect(345, 60, 32, 290);
      var texture = new THREE.CanvasTexture(source);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      var pmrem = new THREE.PMREMGenerator(renderer);
      environmentTarget = pmrem.fromEquirectangular(texture);
      scene.environment = environmentTarget.texture;
      pmrem.dispose();
      texture.dispose();
    }

    function contactShadow(parent, scaleX, scaleZ) {
      var source = canvas(256, 256);
      var ctx = source.getContext('2d');
      var gradient = ctx.createRadialGradient(128, 128, 5, 128, 128, 128);
      gradient.addColorStop(0, 'rgba(24,35,31,0.30)');
      gradient.addColorStop(0.35, 'rgba(24,35,31,0.19)');
      gradient.addColorStop(0.7, 'rgba(24,35,31,0.04)');
      gradient.addColorStop(1, 'rgba(24,35,31,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);
      var texture = track(new THREE.CanvasTexture(source));
      texture.colorSpace = THREE.SRGBColorSpace;
      var material = track(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
      var shadow = mesh(new THREE.PlaneGeometry(scaleX, scaleZ), material, parent);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = -1.689;
      return shadow;
    }

    function buildBottle() {
      bottle = new THREE.Group();
      stage.add(bottle);
      bottleMaterial = track(new THREE.MeshPhysicalMaterial({
        color: '#2d1305', metalness: 0.02, roughness: 0.18,
        clearcoat: 1, clearcoatRoughness: 0.18, ior: 1.5,
        envMapIntensity: 0.86, specularIntensity: 0.75,
      }));
      var body = lathe([
        [0, -1.615], [0.24, -1.615], [0.46, -1.638], [0.59, -1.659],
        [0.66, -1.657], [0.705, -1.632], [0.735, -1.593],
        [0.752, -1.54], [0.759, -1.46], [0.76, -1.37], [0.76, 0.64],
        [0.758, 0.71], [0.751, 0.77], [0.734, 0.826], [0.710, 0.873],
        [0.680, 0.922], [0.637, 0.979], [0.602, 1.023], [0.579, 1.06],
        [0.562, 1.13], [0.562, 1.26], [0.50, 1.26], [0.50, 1.05],
      ], bottleMaterial, bottle);
      body.castShadow = true;
      ring(0.714, 0.023, -1.605, bottleMaterial, bottle);
      ring(0.493, 0.009, -1.641, bottleMaterial, bottle);
      ring(0.563, 0.026, 1.235, bottleMaterial, bottle);
      ring(0.562, 0.012, 1.18, bottleMaterial, bottle);
      labelMaterial = track(new THREE.MeshPhysicalMaterial({ map: labelTexture, color: '#ffffff', roughness: 0.74, metalness: 0, envMapIntensity: 0.23, clearcoat: 0.08 }));
      // One continuous surface avoids the edge seam of a separate front decal.
      var label = mesh(new THREE.CylinderGeometry(0.766, 0.766, 1.96, 192, 1, true, Math.PI, Math.PI * 2), labelMaterial, bottle);
      label.position.y = -0.39;
      label.castShadow = true;
      var cap = new THREE.Group();
      cap.position.y = 1.423;
      bottle.add(cap);
      capMaterial = track(new THREE.MeshPhysicalMaterial({ color: '#e6e3d6', roughness: 0.37, metalness: 0.02, clearcoat: 0.3, clearcoatRoughness: 0.27 }));
      var capBody = lathe([
        [0, -0.195], [0.56, -0.195], [0.615, -0.185], [0.633, -0.16],
        [0.637, -0.12], [0.637, 0.155], [0.632, 0.18], [0.61, 0.195],
        [0.52, 0.201], [0, 0.206],
      ], capMaterial, cap);
      capBody.castShadow = true;
      ribMaterial = track(new THREE.MeshStandardMaterial({ color: '#dddacb', roughness: 0.42, metalness: 0 }));
      var ribs = new THREE.InstancedMesh(track(new THREE.BoxGeometry(0.009, 0.30, 0.011)), ribMaterial, 128);
      var transform = new THREE.Object3D();
      for (var i = 0; i < 128; i++) {
        var theta = i / 128 * Math.PI * 2;
        transform.position.set(Math.sin(theta) * 0.64, 0.004, Math.cos(theta) * 0.64);
        transform.rotation.set(0, theta, 0);
        transform.updateMatrix();
        ribs.setMatrixAt(i, transform.matrix);
      }
      ribs.instanceMatrix.needsUpdate = true;
      cap.add(ribs);
      ring(0.626, 0.012, -0.162, capMaterial, cap);
      ring(0.615, 0.01, 0.185, capMaterial, cap);
      ring(0.493, 0.005, 0.201, capMaterial, cap);
      var lidInset = mesh(new THREE.CylinderGeometry(0.488, 0.488, 0.004, 96), capMaterial, cap);
      lidInset.position.y = 0.204;
      var seal = mesh(new THREE.CylinderGeometry(0.588, 0.585, 0.047, 128, 1, true), capMaterial, bottle);
      seal.position.y = 1.203;
      ring(0.589, 0.006, 1.181, capMaterial, bottle);
      bottleBounds = new THREE.Box3().setFromObject(bottle);
      contactShadow(bottle, 2.65, 2.20);
    }

    function buildCarton() {
      carton = new THREE.Group();
      stage.add(carton);
      cartonMaterial = track(new THREE.MeshPhysicalMaterial({ map: cartonTexture, roughness: 0.76, clearcoat: 0.08, clearcoatRoughness: 0.42, envMapIntensity: 0.22 }));
      var bevel = 0.018;
      var halfW = 0.79 - bevel;
      var halfH = 1.71 - bevel;
      var corner = 0.018;
      var shape = new THREE.Shape();
      shape.moveTo(-halfW + corner, -halfH);
      shape.lineTo(halfW - corner, -halfH);
      shape.quadraticCurveTo(halfW, -halfH, halfW, -halfH + corner);
      shape.lineTo(halfW, halfH - corner);
      shape.quadraticCurveTo(halfW, halfH, halfW - corner, halfH);
      shape.lineTo(-halfW + corner, halfH);
      shape.quadraticCurveTo(-halfW, halfH, -halfW, halfH - corner);
      shape.lineTo(-halfW, -halfH + corner);
      shape.quadraticCurveTo(-halfW, -halfH, -halfW + corner, -halfH);
      var geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.94 - bevel * 2, bevelEnabled: true, bevelThickness: bevel,
        bevelSize: bevel, bevelSegments: 4, steps: 1, curveSegments: 5,
      });
      geometry.translate(0, 0, -(0.94 - bevel * 2) / 2);
      var positions = geometry.attributes.position;
      var normals = geometry.attributes.normal;
      var uv = geometry.attributes.uv;
      // Each triangle chooses a print face. Bevel triangles keep the same
      // packaging color, while the front, back and side artwork remain upright.
      for (var index = 0; index < positions.count; index += 3) {
        var nx = 0, ny = 0, nz = 0;
        for (var n = 0; n < 3; n++) {
          nx += normals.getX(index + n); ny += normals.getY(index + n); nz += normals.getZ(index + n);
        }
        var axis = Math.abs(nz) >= Math.abs(nx) && Math.abs(nz) >= Math.abs(ny) ? 'z' : Math.abs(nx) >= Math.abs(ny) ? 'x' : 'y';
        var face = axis === 'z' ? (nz > 0 ? faces.front : faces.back) : axis === 'x' ? faces.side : ny > 0 ? faces.top : faces.bottom;
        for (var vertex = 0; vertex < 3; vertex++) {
          var offset = index + vertex;
          var x = positions.getX(offset), y = positions.getY(offset), z = positions.getZ(offset);
          var u = axis === 'z' ? (nz > 0 ? x / 1.58 + 0.5 : 0.5 - x / 1.58) : axis === 'x' ? (nx > 0 ? 0.5 - z / 0.94 : z / 0.94 + 0.5) : x / 1.58 + 0.5;
          var v = axis === 'y' ? (ny > 0 ? 0.5 - z / 0.94 : z / 0.94 + 0.5) : y / 3.42 + 0.5;
          uv.setXY(offset, (face.x + clamp(u, 0, 1) * face.w) / 2048, 1 - (face.y + (1 - clamp(v, 0, 1)) * face.h) / 2048);
        }
      }
      uv.needsUpdate = true;
      var box = mesh(geometry, cartonMaterial, carton);
      box.position.y = 0.04;
      box.castShadow = true;
      box.receiveShadow = false;
      // The fine top fold is geometry, not a fictitious ingredient or barcode.
      creaseMaterial = track(new THREE.MeshStandardMaterial({ color: '#b9c0b0', roughness: 0.85 }));
      var crease = mesh(new THREE.BoxGeometry(1.50, 0.0014, 0.006), creaseMaterial, carton);
      crease.position.set(0, 1.751, -0.285);
      var bottomCrease = mesh(new THREE.BoxGeometry(1.47, 0.0014, 0.005), creaseMaterial, carton);
      bottomCrease.position.set(0, -1.671, 0.12);
      cartonBounds = new THREE.Box3().setFromObject(carton);
      contactShadow(carton, 2.8, 2.15);
    }

    function drawBottleLabel() {
      var ctx = labelCanvas.getContext('2d');
      ctx.setTransform(textureScale, 0, 0, textureScale, 0, 0);
      var w = 2048;
      var h = labelLogicalHeight;
      var center = w / 2;
      var ink = inkOn(design.labelColor);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = design.labelColor;
      ctx.fillRect(0, 0, w, h);
      var logoBounds = logo(ctx, design, center, h * 0.245, 660, 254, { top: 20, maxWidth: 950, ink: ink });
      var dividerY = Math.max(h * 0.432, logoBounds.bottom + 24);
      ctx.fillStyle = design.accent;
      ctx.fillRect(center - 255, dividerY, 510, 2);
      var nameTop = dividerY + h * 0.03;
      productText(ctx, design.productName, center, nameTop, 720, Math.max(54, h * 0.667 - nameTop), 67, ink);
      trackedText(ctx, 'DIETARY SUPPLEMENT', center, h * 0.725, 3.1, '500 28px Arial, sans-serif', ink);
      if (design.labelStyle === 'signature') {
        ctx.fillStyle = design.accent;
        ctx.fillRect(0, h * 0.81, w, h * 0.19);
        trackedText(ctx, 'PRIVATE LABEL', center, h * 0.927, 4.2, '600 29px Arial, sans-serif', inkOn(design.accent));
      } else {
        ctx.fillStyle = design.accent;
        ctx.fillRect(0, h * 0.87, w, 3);
        trackedText(ctx, 'PRIVATE LABEL', center, h * 0.955, 3.8, '500 27px Arial, sans-serif', ink);
      }
      trackedText(ctx, 'LABEL CONCEPT', center, h * 0.78, 3.6, '500 21px Arial, sans-serif', ink);
      // Draw across the wrap seam twice. The two clipped halves form one
      // complete back label when the bottle is viewed from behind.
      [0, w].forEach(function (backCenter) {
        logo(ctx, design, backCenter, h * 0.205, 405, 128, { top: 20, maxWidth: 560, ink: ink });
        trackedText(ctx, 'YOUR PRIVATE LABEL', backCenter, h * 0.425, 3.1, '600 32px Arial, sans-serif', ink);
        productText(ctx, 'Packaging concept', backCenter, h * 0.47, 590, h * 0.09, 31, ink);
        productText(ctx, 'Final artwork defined with your brand', backCenter, h * 0.59, 535, h * 0.10, 26, ink);
        ctx.fillStyle = mixHex(design.labelColor, ink, 0.18);
        ctx.fillRect(backCenter - 195, h * 0.73, 390, 2);
        ctx.fillRect(backCenter - 135, h * 0.765, 270, 2);
      });
      labelTexture.needsUpdate = true;
    }

    function drawCarton() {
      var ctx = cartonCanvas.getContext('2d');
      ctx.setTransform(textureScale, 0, 0, textureScale, 0, 0);
      ctx.clearRect(0, 0, 2048, 2048);
      var signature = design.labelStyle === 'signature';
      var paper = design.packagingColor;
      var ink = inkOn(paper);
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, 2048, 2048);
      function face(name, paint) {
        var rect = faces[name];
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
        ctx.clip();
        ctx.translate(rect.x, rect.y);
        ctx.scale(rect.w / 1024, rect.w / 1024);
        paint(1024, rect.h / rect.w * 1024);
        ctx.restore();
      }
      face('front', function (w, h) {
        var center = w * 0.55;
        ctx.fillStyle = design.accent;
        ctx.fillRect(0, 0, signature ? w * 0.085 : w * 0.020, h);
        logo(ctx, design, center, h * 0.245, 675, 435, { top: h * 0.055, maxWidth: w * 0.83, ink: ink });
        ctx.fillStyle = design.accent;
        ctx.fillRect(center - 265, h * 0.432, 530, 3);
        productText(ctx, design.productName, center, h * 0.475, 730, h * 0.17, 96, ink);
        trackedText(ctx, 'DIETARY SUPPLEMENT', center, h * 0.72, 3.7, '500 35px Arial, sans-serif', ink);
        trackedText(ctx, 'LABEL CONCEPT', center, h * 0.765, 5.0, '500 28px Arial, sans-serif', ink);
        ctx.fillStyle = design.accent;
        ctx.fillRect(center - 250, h * 0.861, 500, signature ? 7 : 3);
        trackedText(ctx, 'PRIVATE LABEL', center, h * 0.923, 5.0, '600 35px Arial, sans-serif', ink);
      });
      face('back', function (w, h) {
        logo(ctx, design, w / 2, h * 0.20, 620, 340, { top: h * 0.04, maxWidth: w * 0.84, ink: ink });
        trackedText(ctx, 'YOUR PRIVATE LABEL', w / 2, h * 0.40, 3.9, '600 43px Arial, sans-serif', ink);
        productText(ctx, 'Packaging concept', w / 2, h * 0.46, 770, h * 0.07, 54, ink);
        productText(ctx, 'Final artwork defined with your brand', w / 2, h * 0.57, 730, h * 0.12, 43, ink);
        ctx.fillStyle = mixHex(paper, ink, 0.19);
        [650, 540, 610].forEach(function (length, index) { ctx.fillRect((w - length) / 2, h * (0.735 + index * 0.035), length, 3); });
        ctx.fillStyle = design.accent;
        ctx.fillRect(w * 0.25, h * 0.89, w * 0.5, 6);
      });
      face('side', function (w, h) {
        logo(ctx, design, w / 2, h * 0.22, 620, 385, { top: h * 0.04, maxWidth: w * 0.8, ink: ink });
        ctx.fillStyle = design.accent;
        ctx.fillRect(w * 0.475, h * 0.42, w * 0.05, h * 0.24);
        trackedText(ctx, 'LABEL CONCEPT', w / 2, h * 0.79, 4.2, '600 46px Arial, sans-serif', ink);
        productText(ctx, 'Designed for your brand', w / 2, h * 0.83, 800, h * 0.07, 39, ink);
      });
      face('top', function (w, h) {
        logo(ctx, design, w / 2, h * 0.45, 620, 240, { top: h * 0.10, maxWidth: w * 0.8, ink: ink });
      });
      face('bottom', function (w, h) {
        trackedText(ctx, 'PACKAGING CONCEPT', w / 2, h * 0.50, 4.2, '500 35px Arial, sans-serif', ink);
        ctx.fillStyle = mixHex(paper, ink, 0.16);
        ctx.fillRect(w * 0.25, h * 0.67, w * 0.5, 2);
      });
      cartonTexture.needsUpdate = true;
      setMaterialColor(creaseMaterial, mixHex(paper, ink, 0.16));
    }

    function applyDesign() {
      if (!designDirty) return;
      if (labelDirty) drawBottleLabel();
      if (cartonDirty) drawCarton();
      labelDirty = cartonDirty = false;
      var amber = design.bottleFinish === 'amber';
      var satin = design.surfaceFinish === 'satin';
      setMaterialColor(bottleMaterial, amber ? '#2a1004' : design.bottleFinish === 'custom' ? design.bottleColor : '#eeeee8');
      bottleMaterial.roughness = amber ? 0.16 : satin ? 0.23 : 0.38;
      bottleMaterial.clearcoat = amber ? 1 : satin ? 0.65 : 0.18;
      var capColor = design.capFinish === 'black' ? '#171d1b' : design.capFinish === 'custom' ? design.capColor : '#e6e3d6';
      setMaterialColor(capMaterial, capColor);
      setMaterialColor(ribMaterial, mixHex(capColor, inkOn(capColor), 0.055));
      capMaterial.roughness = satin ? 0.26 : 0.40;
      labelMaterial.roughness = satin ? 0.48 : 0.77;
      labelMaterial.clearcoat = satin ? 0.25 : 0.05;
      cartonMaterial.roughness = satin ? 0.43 : 0.78;
      cartonMaterial.clearcoat = satin ? 0.28 : 0.06;
      designDirty = false;
    }

    function composition() {
      bottle.visible = packaging !== 'carton';
      carton.visible = packaging !== 'bottle';
      bottle.position.set(packaging === 'set' ? -0.64 : 0, 0, packaging === 'set' ? 0.38 : 0);
      carton.position.set(packaging === 'set' ? 0.69 : 0, 0, packaging === 'set' ? -0.39 : 0);
      carton.rotation.y = cartonYaw;
      stage.rotation.y = 0;
      stage.updateMatrixWorld(true);
      camera.position.set(-Math.sin(yaw) * Math.cos(pitch) * 9, 0.06 + Math.sin(pitch) * 9, Math.cos(yaw) * Math.cos(pitch) * 9);
      camera.lookAt(0, 0.06, 0);
      camera.updateMatrixWorld(true);
      var aspect = width / height;
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      [[bottle, bottleBounds], [carton, cartonBounds]].forEach(function (entry) {
        if (!entry[0].visible) return;
        var bounds = entry[1];
        for (var corner = 0; corner < 8; corner++) {
          var point = new THREE.Vector3(corner & 1 ? bounds.max.x : bounds.min.x, corner & 2 ? bounds.max.y : bounds.min.y, corner & 4 ? bounds.max.z : bounds.min.z);
          point.applyMatrix4(entry[0].matrixWorld).applyMatrix4(camera.matrixWorldInverse);
          minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
        }
      });
      var projectedWidth = maxX - minX;
      var projectedHeight = maxY - minY;
      var vertical = Math.max(4.30, projectedHeight * 1.15, projectedWidth / aspect * 1.15);
      var safeZoom = Math.min(1.65, vertical / (projectedHeight + 0.16), vertical * aspect / (projectedWidth + 0.16));
      zoom = clamp(zoom, 0.72, safeZoom);
      var centerX = (minX + maxX) / 2;
      var centerY = (minY + maxY) / 2;
      camera.left = centerX - vertical * aspect / 2;
      camera.right = centerX + vertical * aspect / 2;
      camera.top = centerY + vertical / 2;
      camera.bottom = centerY - vertical / 2;
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      mount.dataset.view = view;
      mount.dataset.yaw = yaw.toFixed(4);
      mount.dataset.pitch = pitch.toFixed(4);
      mount.dataset.zoom = zoom.toFixed(4);
      mount.dataset.autoRotate = String(autoRotate);
      mount.dataset.orbitMode = String(orbitMode);
    }

    function draw() {
      applyDesign();
      composition();
      renderer.render(scene, camera);
      renderCount += 1;
      mount.dataset.renderCount = String(renderCount);
    }

    function rotationEvent(source) {
      mount.dispatchEvent(new global.CustomEvent('innovita:rotate', { bubbles: true, detail: {
        source: source, autoRotate: autoRotate, orbitMode: orbitMode,
        yaw: yaw, pitch: pitch, zoom: zoom, view: view,
      } }));
    }

    function changeOrbit(deltaYaw, deltaPitch, source) {
      autoRotate = false;
      lastFrameTime = 0;
      view = 'custom';
      yaw = ((yaw + deltaYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      pitch = clamp(pitch + deltaPitch, -1.45, 1.45);
      composition();
      rotationEvent(source || 'control');
      requestFrame();
    }

    function requestFrame() {
      needsFrame = true;
      if (disposed || contextLost || exporting || raf || !visible || document.hidden) return;
      raf = global.requestAnimationFrame(function (time) {
        raf = 0;
        if (disposed || contextLost || exporting || !visible || document.hidden) return;
        try {
          if (autoRotate && !reduced) {
            var elapsed = lastFrameTime ? Math.min((time - lastFrameTime) / 1000, 0.05) : 1 / 60;
            yaw = (yaw + elapsed * 0.17) % (Math.PI * 2);
            view = 'custom';
            lastFrameTime = time;
          } else lastFrameTime = 0;
          draw();
          needsFrame = false;
          if (!ready) {
            ready = true;
            if (typeof options.onReady === 'function') options.onReady(api);
          }
          if (autoRotate && !reduced) {
            if (time - lastAutoEvent > 120) { lastAutoEvent = time; rotationEvent('auto'); }
            requestFrame();
          }
        } catch (error) { fatal(error); }
      });
    }

    function resize() {
      if (disposed || contextLost || !renderer) return;
      var rect = mount.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width || mount.clientWidth));
      height = Math.max(1, Math.round(rect.height || mount.clientHeight || width));
      var desiredRatio = clamp(global.devicePixelRatio || 1, 1.5, 2.5);
      pixelRatio = Math.min(desiredRatio, Math.sqrt(4500000 / (width * height)));
      mount.dataset.pixelRatio = pixelRatio.toFixed(3);
      if (!exporting) {
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(width, height, false);
      }
      requestFrame();
    }

    function watchLogo() {
      if (logoListener) { logoListener(); logoListener = null; }
      var image = design.logo;
      if (!image || image.complete || !image.addEventListener) return;
      var loaded = function () { designDirty = labelDirty = cartonDirty = true; requestFrame(); };
      image.addEventListener('load', loaded, { once: true });
      logoListener = function () { image.removeEventListener('load', loaded); };
    }

    function destroy() {
      if (disposed) return;
      disposed = true;
      if (raf) global.cancelAnimationFrame(raf);
      raf = 0;
      if (observer) observer.disconnect();
      if (intersection) intersection.disconnect();
      if (logoListener) logoListener();
      removers.forEach(function (remove) { remove(); });
      resources.forEach(function (resource) { resource.dispose(); });
      resources.clear();
      if (environmentTarget) environmentTarget.dispose();
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
        if (!contextLost) renderer.forceContextLoss();
      }
      mount.style.touchAction = originalTouchAction;
      mount.style.cursor = originalCursor;
      delete mount.dataset.dragging;
    }

    function fatal(error) {
      if (disposed) return;
      destroy();
      if (typeof options.onError === 'function') options.onError(error instanceof Error ? error : new Error(String(error)));
    }

    function exportPng() {
      if (disposed || contextLost) return Promise.reject(new Error('The studio is not available for export.'));
      if (exportPromise) return exportPromise;
      exporting = true;
      if (raf) global.cancelAnimationFrame(raf);
      raf = 0;
      var pendingExport = new Promise(function (resolve, reject) {
        function finish(error, blob) {
          exporting = false;
          if (!disposed && !contextLost) {
            renderer.setPixelRatio(pixelRatio);
            renderer.setSize(width, height, false);
            requestFrame();
          }
          if (error) reject(error);
          else resolve(blob);
        }
        try {
          // Keep the current composition and aspect ratio, with enough output
          // pixels for a clear preview deck. No preserved WebGL buffer is needed:
          // toBlob is invoked immediately after this fresh synchronous render.
          var scale = Math.min(3072, renderer.capabilities.maxTextureSize || 4096) / Math.max(width, height);
          renderer.setPixelRatio(1);
          renderer.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), false);
          draw();
          renderer.domElement.toBlob(function (blob) {
            if (disposed || contextLost) finish(new Error('The studio closed before the export completed.'));
            else if (!blob) finish(new Error('The PNG could not be generated.'));
            else finish(null, blob);
          }, 'image/png');
        } catch (error) { finish(error); }
      });
      exportPromise = pendingExport;
      pendingExport.then(function () {
        if (exportPromise === pendingExport) exportPromise = null;
      }, function () {
        if (exportPromise === pendingExport) exportPromise = null;
      });
      return pendingExport;
    }

    var api = {
      update: function (next) {
        if (disposed) return;
        var previous = design;
        design = normalize(next, design);
        designDirty = Object.keys(DEFAULTS).some(function (key) { return previous[key] !== design[key]; }) || designDirty;
        var artKeys = ['logo', 'productName', 'accent', 'labelStyle', 'logoScale', 'logoOffsetY'];
        var artworkChanged = artKeys.some(function (key) { return previous[key] !== design[key]; });
        labelDirty = labelDirty || artworkChanged || previous.labelColor !== design.labelColor;
        cartonDirty = cartonDirty || artworkChanged || previous.packagingColor !== design.packagingColor;
        if (previous.logo !== design.logo) watchLogo();
        if (designDirty) requestFrame();
      },
      setPackaging: function (next) {
        if (disposed || ['set', 'bottle', 'carton'].indexOf(next) < 0) return;
        packaging = next;
        requestFrame();
      },
      setView: function (next) {
        if (disposed || ['front', 'angle', 'back', 'left', 'right', 'top'].indexOf(next) < 0) return;
        autoRotate = false;
        lastFrameTime = 0;
        view = next;
        cartonYaw = next === 'angle' ? -0.07 : 0;
        var views = { front: [0, 0.035], angle: [-0.26, 0.19], back: [Math.PI, 0.13], left: [Math.PI / 2, 0.11], right: [-Math.PI / 2, 0.11], top: [-0.12, 1.43] };
        yaw = views[next][0];
        pitch = views[next][1];
        composition();
        rotationEvent('control');
        requestFrame();
      },
      rotateBy: function (radians) {
        if (disposed || !Number.isFinite(Number(radians))) return;
        changeOrbit(Number(radians), 0, 'control');
      },
      tiltBy: function (radians) {
        if (disposed || !Number.isFinite(Number(radians))) return;
        changeOrbit(0, Number(radians), 'control');
      },
      zoomBy: function (factor, source) {
        factor = Number(factor);
        if (disposed || !Number.isFinite(factor) || factor <= 0) return;
        autoRotate = false;
        lastFrameTime = 0;
        zoom = clamp(zoom * factor, 0.72, 1.65);
        composition();
        rotationEvent(source || 'control');
        requestFrame();
      },
      setAutoRotate: function (enabled) {
        if (disposed) return;
        autoRotate = Boolean(enabled) && !reduced;
        lastFrameTime = 0;
        rotationEvent('control');
        requestFrame();
      },
      setOrbitMode: function (enabled) {
        if (disposed) return;
        orbitMode = Boolean(enabled);
        mount.style.touchAction = orbitMode ? 'none' : 'pan-y';
        renderer.domElement.style.touchAction = orbitMode ? 'none' : 'pan-y';
        touches.clear();
        pinchDistance = 0;
        pointer = null;
        rotationEvent('control');
        requestFrame();
      },
      resetView: function () {
        if (disposed) return;
        autoRotate = false;
        lastFrameTime = 0;
        view = 'angle';
        cartonYaw = -0.07;
        yaw = -0.26;
        pitch = 0.19;
        zoom = 1;
        composition();
        rotationEvent('control');
        requestFrame();
      },
      exportPng: exportPng,
      destroy: destroy,
    };

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.02;
      // Broad studio illumination uses the two soft contact shadows below.
      // A small directional shadow map creates a hard silhouette on the carton.
      renderer.shadowMap.enabled = false;
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y';
      renderer.domElement.setAttribute('aria-hidden', 'true');
      mount.appendChild(renderer.domElement);
      mount.style.touchAction = 'pan-y';
      mount.style.cursor = 'grab';
      scene = new THREE.Scene();
      scene.background = new THREE.Color(CREAM);
      camera = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 50);
      camera.position.set(0, 1.28, 9);
      camera.lookAt(0, 0.07, 0);
      stage = new THREE.Group();
      scene.add(stage);
      scene.add(new THREE.HemisphereLight('#fffdf8', '#969b95', 1.10));
      var key = new THREE.DirectionalLight('#fff7e7', 2.7);
      key.position.set(-3.5, 5, 5);
      scene.add(key);
      var fill = new THREE.DirectionalLight('#edf3f1', 0.95);
      fill.position.set(4, 2, 4);
      scene.add(fill);
      var rim = new THREE.DirectionalLight('#fff3dd', 1.9);
      rim.position.set(2, 4, -3);
      scene.add(rim);
      environment();
      textureScale = global.matchMedia && global.matchMedia('(max-width: 700px)').matches ? 1.5 : 2;
      textureScale = Math.min(textureScale, (renderer.capabilities.maxTextureSize || 4096) / 2048);
      labelCanvas = canvas(Math.round(2048 * textureScale), Math.round(labelLogicalHeight * textureScale));
      cartonCanvas = canvas(Math.round(2048 * textureScale), Math.round(2048 * textureScale));
      labelTexture = track(new THREE.CanvasTexture(labelCanvas));
      cartonTexture = track(new THREE.CanvasTexture(cartonCanvas));
      [labelTexture, cartonTexture].forEach(function (texture) {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
      });
      buildBottle();
      buildCarton();
      watchLogo();

      listen(renderer.domElement, 'webglcontextlost', function (event) {
        event.preventDefault();
        contextLost = true;
        fatal(new Error('The graphics context was lost. Please reopen the studio.'));
      });
      listen(mount, 'pointerdown', function (event) {
        if (disposed || (event.target.closest && event.target.closest('button, input, select, textarea, a'))) return;
        var touch = event.pointerType === 'touch';
        if (touch && orbitMode) {
          touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
          try { mount.setPointerCapture(event.pointerId); } catch (error) { /* A cancelled pointer needs no capture. */ }
          if (touches.size > 1) { pointer = null; pinchDistance = 0; return; }
        }
        if (!event.isPrimary || (event.button !== 0 && event.button !== 2)) return;
        pointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, full: !touch || orbitMode, claimed: false };
      });
      listen(mount, 'pointermove', function (event) {
        if (orbitMode && touches.has(event.pointerId)) {
          touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (touches.size >= 2) {
            var points = Array.from(touches.values());
            var distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            if (pinchDistance > 1 && distance > 1) api.zoomBy(distance / pinchDistance, 'user');
            pinchDistance = distance;
            if (event.cancelable) event.preventDefault();
            return;
          }
        }
        if (!pointer || pointer.id !== event.pointerId || disposed) return;
        var dx = event.clientX - pointer.startX;
        var dy = event.clientY - pointer.startY;
        if (!pointer.claimed) {
          if (!pointer.full && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx) * 1.1) { pointer = null; return; }
          if (pointer.full ? Math.hypot(dx, dy) < 5 : Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
          pointer.claimed = true;
          try { mount.setPointerCapture(event.pointerId); } catch (error) { /* The pointer may already have ended. */ }
          mount.style.cursor = 'grabbing';
          mount.dataset.dragging = 'true';
        }
        if (event.cancelable) event.preventDefault();
        changeOrbit((event.clientX - pointer.lastX) * Math.PI * 2 / (Math.max(width, 250) * 1.8), pointer.full ? (event.clientY - pointer.lastY) * 0.005 : 0, 'user');
        pointer.lastX = event.clientX;
        pointer.lastY = event.clientY;
      }, { passive: false });
      function endPointer(event) {
        touches.delete(event.pointerId);
        if (touches.size < 2) pinchDistance = 0;
        if (!pointer || pointer.id !== event.pointerId) return;
        try { if (mount.hasPointerCapture(event.pointerId)) mount.releasePointerCapture(event.pointerId); } catch (error) { /* No capture remains. */ }
        pointer = null;
        mount.style.cursor = 'grab';
        delete mount.dataset.dragging;
      }
      listen(mount, 'pointerup', endPointer);
      listen(mount, 'pointercancel', endPointer);
      listen(mount, 'lostpointercapture', endPointer);
      listen(mount, 'contextmenu', function (event) { event.preventDefault(); });
      listen(mount, 'wheel', function (event) {
        if (!orbitMode || disposed) return;
        event.preventDefault();
        api.zoomBy(Math.exp(-clamp(event.deltaY, -120, 120) * 0.0025), 'user');
      }, { passive: false });
      listen(global, 'resize', resize, { passive: true });
      listen(document, 'visibilitychange', function () {
        if (document.hidden && raf) { global.cancelAnimationFrame(raf); raf = 0; lastFrameTime = 0; }
        else if (!document.hidden && (needsFrame || autoRotate)) requestFrame();
      });
      if ('ResizeObserver' in global) {
        observer = new ResizeObserver(resize);
        observer.observe(mount);
      }
      if ('IntersectionObserver' in global) {
        intersection = new IntersectionObserver(function (entries) {
          visible = entries[0].isIntersecting;
          if (!visible) {
            if (raf) global.cancelAnimationFrame(raf);
            raf = 0;
            lastFrameTime = 0;
          } else if (needsFrame || autoRotate) requestFrame();
        }, { rootMargin: '100px 0px' });
        intersection.observe(mount);
      }
      function motionChange() {
        reduced = motionQuery.matches;
        if (reduced) {
          autoRotate = false;
          lastFrameTime = 0;
          rotationEvent('control');
          requestFrame();
        }
      }
      if (motionQuery.addEventListener) listen(motionQuery, 'change', motionChange);
      else if (motionQuery.addListener) {
        motionQuery.addListener(motionChange);
        removers.push(function () { motionQuery.removeListener(motionChange); });
      }
      resize();
    } catch (error) { fatal(error); }
    return api;
  }

  global.InnovitaStudioScene = { create: create };
})(window);
