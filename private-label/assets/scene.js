/* Innovita private-label studio. All artwork and lighting are generated locally.
 * Requires the self-hosted Three.js r160 global; never requests remote resources.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    logo: null, productName: 'Daily essentials', accent: '#2c707a',
    bottleFinish: 'amber', capFinish: 'ivory', labelStyle: 'signature',
    logoScale: 1, logoOffsetY: 0,
  };
  var CREAM = '#f3f0e8';
  var INK = '#183347';
  var clamp = function (value, min, max) { return Math.max(min, Math.min(max, value)); };

  function normalize(input, previous) {
    var next = Object.assign({}, previous || DEFAULTS, input || {});
    next.productName = String(next.productName || DEFAULTS.productName).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 90) || DEFAULTS.productName;
    next.accent = /^#[\da-f]{6}$/i.test(next.accent) ? next.accent : DEFAULTS.accent;
    next.bottleFinish = next.bottleFinish === 'white' ? 'white' : 'amber';
    next.capFinish = next.capFinish === 'black' ? 'black' : 'ivory';
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

  function productText(ctx, text, centerX, topY, maxWidth, maxHeight, size) {
    var lines;
    var fontSize = size;
    do {
      ctx.font = '500 ' + fontSize + 'px Arial, sans-serif';
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
    ctx.fillStyle = INK;
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
      trackedText(ctx, 'YOUR BRAND', centerX, shiftedY + size * 0.34, size * 0.045, '600 ' + size + 'px Arial, sans-serif', INK);
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
    var width = 1;
    var height = 1;
    var pixelRatio = 1;
    var disposed = false;
    var contextLost = false;
    var ready = false;
    var visible = true;
    var designDirty = true;
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
    var cartonSide;
    var cartonTop;
    var cartonBack;
    var labelTexture;
    var cartonTexture;
    var environmentTarget;
    var observer;
    var intersection;
    var pointer = null;
    var logoListener = null;
    var originalTouchAction = mount.style.touchAction;
    var originalCursor = mount.style.cursor;
    var resources = new Set();
    var removers = [];
    // Full-wrap bottle art has its seam at the back. Physical and bitmap aspect
    // ratios match, so a circular uploaded logo is never stretched by the canvas.
    var labelCanvas = canvas(2048, Math.round(2048 * 1.96 / (Math.PI * 2 * 0.766)));
    var cartonCanvas = canvas(1024, Math.round(1024 * 3.42 / 1.58));

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
        [0, -1.66], [0.50, -1.66], [0.65, -1.65], [0.72, -1.61],
        [0.753, -1.54], [0.76, -1.41], [0.76, 0.64], [0.753, 0.76],
        [0.731, 0.84], [0.694, 0.91], [0.633, 1.0], [0.579, 1.06],
        [0.562, 1.13], [0.562, 1.26], [0.50, 1.26], [0.50, 1.05],
      ], bottleMaterial, bottle);
      body.castShadow = true;
      ring(0.714, 0.023, -1.605, bottleMaterial, bottle);
      ring(0.563, 0.026, 1.235, bottleMaterial, bottle);
      var labelMaterial = track(new THREE.MeshStandardMaterial({ map: labelTexture, color: '#ffffff', roughness: 0.88, metalness: 0, envMapIntensity: 0.17 }));
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
      contactShadow(bottle, 2.65, 2.20);
    }

    function buildCarton() {
      carton = new THREE.Group();
      stage.add(carton);
      cartonSide = track(new THREE.MeshStandardMaterial({ color: '#dbe2d5', roughness: 0.94, envMapIntensity: 0.15 }));
      cartonTop = track(new THREE.MeshStandardMaterial({ color: '#eeeade', roughness: 0.94, envMapIntensity: 0.12 }));
      cartonBack = track(new THREE.MeshStandardMaterial({ color: '#e1e6d9', roughness: 0.94, envMapIntensity: 0.12 }));
      var front = track(new THREE.MeshStandardMaterial({ map: cartonTexture, roughness: 0.91, envMapIntensity: 0.14 }));
      var geometry = new THREE.BoxGeometry(1.58, 3.42, 0.94);
      var box = mesh(geometry, [cartonSide, cartonSide, cartonTop, cartonTop, front, cartonBack], carton);
      box.position.y = 0.04;
      box.castShadow = true;
      box.receiveShadow = false;
      var edgeMaterial = track(new THREE.LineBasicMaterial({ color: '#556357', transparent: true, opacity: 0.085 }));
      var edges = new THREE.LineSegments(track(new THREE.EdgesGeometry(geometry)), edgeMaterial);
      edges.position.copy(box.position);
      carton.add(edges);
      // The fine top fold is geometry, not a fictitious ingredient or barcode.
      var crease = mesh(new THREE.BoxGeometry(1.53, 0.002, 0.012), track(new THREE.MeshStandardMaterial({ color: '#b9c0b0', roughness: 1 })), carton);
      crease.position.set(0, 1.752, -0.30);
      contactShadow(carton, 2.8, 2.15);
    }

    function drawBottleLabel() {
      var ctx = labelCanvas.getContext('2d');
      var w = labelCanvas.width;
      var h = labelCanvas.height;
      var center = w / 2;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = CREAM;
      ctx.fillRect(0, 0, w, h);
      var logoBounds = logo(ctx, design, center, h * 0.245, 640, 250, { top: 20, maxWidth: 950 });
      var dividerY = Math.max(h * 0.432, logoBounds.bottom + 24);
      ctx.fillStyle = design.accent;
      ctx.fillRect(center - 255, dividerY, 510, 2);
      var nameTop = dividerY + h * 0.03;
      productText(ctx, design.productName, center, nameTop, 710, Math.max(54, h * 0.667 - nameTop), 63);
      trackedText(ctx, 'DIETARY SUPPLEMENT', center, h * 0.725, 3.3, '400 25px Arial, sans-serif', '#657268');
      if (design.labelStyle === 'signature') {
        ctx.fillStyle = design.accent;
        ctx.fillRect(0, h * 0.81, w, h * 0.19);
        trackedText(ctx, '60 CAPSULES', center, h * 0.927, 4.5, '500 29px Arial, sans-serif', '#ffffff');
      } else {
        ctx.fillStyle = design.accent;
        ctx.fillRect(0, h * 0.87, w, 3);
        trackedText(ctx, '60 CAPSULES', center, h * 0.955, 3.8, '400 26px Arial, sans-serif', INK);
      }
      trackedText(ctx, 'LABEL CONCEPT', center, h * 0.78, 3.7, '400 18px Arial, sans-serif', '#7c8378');
      labelTexture.needsUpdate = true;
    }

    function drawCarton() {
      var ctx = cartonCanvas.getContext('2d');
      var w = cartonCanvas.width;
      var h = cartonCanvas.height;
      var signature = design.labelStyle === 'signature';
      var paper = signature ? mixHex(design.accent, '#f3f0e8', 0.88) : CREAM;
      var center = w * 0.56;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = design.accent;
      ctx.fillRect(0, 0, signature ? w * 0.108 : w * 0.024, h);
      logo(ctx, design, center, h * 0.245, 640, 420, { top: h * 0.055, maxWidth: w * 0.81 });
      ctx.fillStyle = design.accent;
      ctx.fillRect(center - 260, h * 0.432, 520, 3);
      productText(ctx, design.productName, center, h * 0.485, 710, h * 0.16, 91);
      trackedText(ctx, 'DIETARY SUPPLEMENT', center, h * 0.72, 3.9, '400 32px Arial, sans-serif', '#657268');
      trackedText(ctx, 'LABEL CONCEPT', center, h * 0.76, 5.5, '400 24px Arial, sans-serif', '#7c8378');
      ctx.fillStyle = design.accent;
      ctx.fillRect(center - 250, h * 0.864, 500, signature ? 7 : 3);
      trackedText(ctx, '60 CAPSULES', center, h * 0.923, 5.5, '500 32px Arial, sans-serif', INK);
      cartonTexture.needsUpdate = true;
      setMaterialColor(cartonSide, mixHex(design.accent, '#f3f0e8', signature ? 0.79 : 0.91));
      setMaterialColor(cartonBack, paper);
      setMaterialColor(cartonTop, paper);
    }

    function applyDesign() {
      if (!designDirty) return;
      drawBottleLabel();
      drawCarton();
      var white = design.bottleFinish === 'white';
      setMaterialColor(bottleMaterial, white ? '#e9e8df' : '#2d1305');
      bottleMaterial.roughness = white ? 0.29 : 0.18;
      bottleMaterial.clearcoat = white ? 0.48 : 1;
      var black = design.capFinish === 'black';
      setMaterialColor(capMaterial, black ? '#202520' : '#e6e3d6');
      setMaterialColor(ribMaterial, black ? '#252b24' : '#dddacb');
      designDirty = false;
    }

    function composition() {
      bottle.visible = packaging !== 'carton';
      carton.visible = packaging !== 'bottle';
      bottle.position.set(packaging === 'set' ? -0.64 : 0, 0, packaging === 'set' ? 0.38 : 0);
      carton.position.set(packaging === 'set' ? 0.69 : 0, 0, packaging === 'set' ? -0.39 : 0);
      carton.rotation.y = view === 'front' ? 0 : -0.10;
      stage.rotation.y = yaw;
      var aspect = width / height;
      var requiredWidth = packaging === 'set' ? 3.82 : 2.75;
      var vertical = Math.max(4.34, requiredWidth / aspect);
      camera.left = -vertical * aspect / 2;
      camera.right = vertical * aspect / 2;
      camera.top = vertical / 2;
      camera.bottom = -vertical / 2;
      camera.updateProjectionMatrix();
    }

    function draw() {
      applyDesign();
      composition();
      renderer.render(scene, camera);
    }

    function requestFrame() {
      needsFrame = true;
      if (disposed || contextLost || exporting || raf || !visible || document.hidden) return;
      raf = global.requestAnimationFrame(function () {
        raf = 0;
        if (disposed || contextLost || exporting || !visible || document.hidden) return;
        try {
          draw();
          needsFrame = false;
          if (!ready) {
            ready = true;
            if (typeof options.onReady === 'function') options.onReady(api);
          }
        } catch (error) { fatal(error); }
      });
    }

    function resize() {
      if (disposed || contextLost || !renderer) return;
      var rect = mount.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width || mount.clientWidth));
      height = Math.max(1, Math.round(rect.height || mount.clientHeight || width));
      pixelRatio = Math.min(global.devicePixelRatio || 1, 2);
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
      var loaded = function () { designDirty = true; requestFrame(); };
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
          var scale = Math.min(2048 / Math.max(width, height), 4);
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
        if (previous.logo !== design.logo) watchLogo();
        if (designDirty) requestFrame();
      },
      setPackaging: function (next) {
        if (disposed || ['set', 'bottle', 'carton'].indexOf(next) < 0) return;
        packaging = next;
        requestFrame();
      },
      setView: function (next) {
        if (disposed || ['front', 'angle'].indexOf(next) < 0) return;
        view = next;
        yaw = next === 'front' ? 0 : -0.20;
        requestFrame();
      },
      rotateBy: function (radians) {
        if (disposed || !Number.isFinite(Number(radians))) return;
        yaw = (yaw + Number(radians)) % (Math.PI * 2);
        requestFrame();
      },
      resetView: function () {
        if (disposed) return;
        view = 'angle';
        yaw = -0.20;
        requestFrame();
      },
      exportPng: exportPng,
      destroy: destroy,
    };

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.04;
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
      scene.add(new THREE.HemisphereLight('#fffdf3', '#8b8e7c', 1.6));
      var key = new THREE.DirectionalLight('#fff7e7', 2.7);
      key.position.set(-3.5, 5, 5);
      scene.add(key);
      var fill = new THREE.DirectionalLight('#e7f1ee', 1.12);
      fill.position.set(4, 2, 4);
      scene.add(fill);
      var rim = new THREE.DirectionalLight('#fff3dd', 1.9);
      rim.position.set(2, 4, -3);
      scene.add(rim);
      environment();
      labelTexture = track(new THREE.CanvasTexture(labelCanvas));
      cartonTexture = track(new THREE.CanvasTexture(cartonCanvas));
      [labelTexture, cartonTexture].forEach(function (texture) {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
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
        if (!event.isPrimary || event.button !== 0 || disposed || (event.target.closest && event.target.closest('button, input, select, textarea, a'))) return;
        pointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, claimed: false };
      });
      listen(mount, 'pointermove', function (event) {
        if (!pointer || pointer.id !== event.pointerId || disposed) return;
        var dx = event.clientX - pointer.startX;
        var dy = event.clientY - pointer.startY;
        if (!pointer.claimed) {
          if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx) * 1.1) { pointer = null; return; }
          if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
          pointer.claimed = true;
          try { mount.setPointerCapture(event.pointerId); } catch (error) { /* The pointer may already have ended. */ }
          mount.style.cursor = 'grabbing';
          mount.dataset.dragging = 'true';
        }
        if (event.cancelable) event.preventDefault();
        api.rotateBy((event.clientX - pointer.lastX) * Math.PI * 2 / (Math.max(width, 250) * 1.8));
        mount.dispatchEvent(new CustomEvent('innovita:rotate'));
        pointer.lastX = event.clientX;
      }, { passive: false });
      function endPointer(event) {
        if (!pointer || pointer.id !== event.pointerId) return;
        try { if (mount.hasPointerCapture(event.pointerId)) mount.releasePointerCapture(event.pointerId); } catch (error) { /* No capture remains. */ }
        pointer = null;
        mount.style.cursor = 'grab';
        delete mount.dataset.dragging;
      }
      listen(mount, 'pointerup', endPointer);
      listen(mount, 'pointercancel', endPointer);
      listen(mount, 'lostpointercapture', endPointer);
      listen(global, 'resize', resize, { passive: true });
      listen(document, 'visibilitychange', function () {
        if (document.hidden && raf) { global.cancelAnimationFrame(raf); raf = 0; }
        else if (!document.hidden && needsFrame) requestFrame();
      });
      if ('ResizeObserver' in global) {
        observer = new ResizeObserver(resize);
        observer.observe(mount);
      }
      if ('IntersectionObserver' in global) {
        intersection = new IntersectionObserver(function (entries) {
          visible = entries[0].isIntersecting;
          if (visible && needsFrame) requestFrame();
        }, { rootMargin: '100px 0px' });
        intersection.observe(mount);
      }
      resize();
    } catch (error) { fatal(error); }
    return api;
  }

  global.InnovitaStudioScene = { create: create };
})(window);
