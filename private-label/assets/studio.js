/* Local-only concept studio. Uploaded artwork never leaves this browser. */
(function () {
  'use strict';

  var MAX_FILE_BYTES = 8 * 1024 * 1024;
  var MAX_IMAGE_PIXELS = 24 * 1000 * 1000;
  var MAX_TEXTURE_EDGE = 2048;
  var DEFAULTS = Object.freeze({
    logo: null,
    productName: 'Daily essentials',
    accent: '#2c707a',
    bottleFinish: 'amber',
    capFinish: 'ivory',
    packagingColor: '#f3f0e8',
    labelColor: '#f3f0e8',
    capColor: '#e6e3d6',
    bottleColor: '#f2f0e8',
    surfaceFinish: 'satin',
    labelStyle: 'signature',
    logoScale: 1,
    logoOffsetY: 0,
  });

  function start() {
    var mount = document.getElementById('preview-mount');
    if (!mount || mount.dataset.controllerMounted === 'true') return;
    mount.dataset.controllerMounted = 'true';

    var byId = function (id) { return document.getElementById(id); };
    var all = function (selector) { return Array.from(document.querySelectorAll(selector)); };
    var design = Object.assign({}, DEFAULTS);
    var scene = null;
    var sceneState = 'loading';
    var sceneFailed = false;
    var destroyed = false;
    var updateFrame = 0;
    var uploadGeneration = 0;
    var uploadAbort = null;
    var exporting = false;
    var designVersion = 0;
    var lastDownloadUrl = '';
    var logoData = '';
    var packaging = 'set';
    var selectedView = 'angle';
    var linkedLabel = true;
    var autoRotate = false;
    var orbitMode = false;
    var cameraCommandDepth = 0;
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var viewNames = ['front', 'angle', 'back', 'left', 'right', 'top'];
    var previewShell = mount.closest('.preview-shell');
    var fullscreenButton = byId('expand-preview');
    var fullscreenText = fullscreenButton && fullscreenButton.querySelector('span');
    var fullscreenLabel = fullscreenText ? fullscreenText.textContent : 'Expand preview';
    var previewExpanded = false;
    var expansionSnapshot = null;
    var pendingUrls = new Set();
    var timers = new Set();
    var cleanup = [];
    var fallback = byId('fallback-preview');
    var fileInput = byId('logo-file');
    var dropzone = byId('logo-dropzone');
    var uploadStatus = byId('upload-status');
    var studioStatus = byId('studio-status');
    var downloadButton = byId('download-preview');
    var downloadText = downloadButton && downloadButton.querySelector('span');
    if (downloadButton && !downloadText) {
      downloadText = document.createElement('span');
      downloadText.textContent = 'Download preview';
      downloadButton.appendChild(downloadText);
    }
    var downloadLabel = downloadText ? downloadText.textContent : 'Download preview';
    var fallbackLogoNodes = [byId('fallback-logo'), byId('fallback-logo-carton')].filter(Boolean);
    var fallbackLogoBounds = new Map();
    fallbackLogoNodes.forEach(function (node) {
      fallbackLogoBounds.set(node, {
        x: Number(node.getAttribute('x')) || 0,
        y: Number(node.getAttribute('y')) || 0,
        width: Number(node.getAttribute('width')) || 120,
        height: Number(node.getAttribute('height')) || 80,
      });
    });

    function listen(node, event, handler, options) {
      if (!node) return;
      node.addEventListener(event, handler, options);
      cleanup.push(function () { node.removeEventListener(event, handler, options); });
    }

    function status(node, message, error) {
      if (!node || destroyed) return;
      node.textContent = message;
      node.dataset.state = error ? 'error' : 'success';
      if (node === uploadStatus && byId('mobile-upload-status')) {
        byId('mobile-upload-status').textContent = message;
        byId('mobile-upload-status').dataset.state = error ? 'error' : 'success';
      }
    }

    function later(callback, delay) {
      var id = window.setTimeout(function () { timers.delete(id); callback(); }, delay);
      timers.add(id);
      return id;
    }

    function objectUrl(blob) {
      var url = URL.createObjectURL(blob);
      pendingUrls.add(url);
      return url;
    }

    function revoke(url) {
      if (pendingUrls.delete(url)) URL.revokeObjectURL(url);
    }

    function invalidateDownload() {
      if (lastDownloadUrl) revoke(lastDownloadUrl);
      lastDownloadUrl = '';
      var link = byId('download-ready');
      if (link) {
        link.hidden = true;
        link.removeAttribute('href');
        link.removeAttribute('download');
        var oldThumb = link.querySelector('img');
        if (oldThumb) oldThumb.removeAttribute('src');
      }
    }

    function abortError() {
      var error = new Error('The upload was cancelled.');
      error.name = 'AbortError';
      return error;
    }

    function assertCurrent(signal) {
      if (destroyed || (signal && signal.aborted)) throw abortError();
    }

    function loadImage(url, signal) {
      return new Promise(function (resolve, reject) {
        var image = new Image();
        var complete = false;
        var timeout = later(function () { finish(new Error('The image took too long to open. Please try a smaller file.')); }, 12000);
        function finish(error) {
          if (complete) return;
          complete = true;
          clearTimeout(timeout);
          timers.delete(timeout);
          image.onload = null;
          image.onerror = null;
          if (signal) signal.removeEventListener('abort', onAbort);
          if (error) { image.src = ''; reject(error); }
          else resolve(image);
        }
        function onAbort() { finish(abortError()); }
        image.onload = function () {
          if (!image.naturalWidth || !image.naturalHeight) finish(new Error('This image has no usable dimensions.'));
          else finish();
        };
        image.onerror = function () { finish(new Error('This image could not be opened. Please export it as PNG, JPEG, WebP or a self-contained SVG.')); };
        if (signal) {
          if (signal.aborted) { onAbort(); return; }
          signal.addEventListener('abort', onAbort, { once: true });
        }
        image.src = url;
      });
    }

    function validateDimensions(width, height) {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
        throw new Error('This image has no usable dimensions.');
      }
      if (width * height > MAX_IMAGE_PIXELS || width > 32768 || height > 32768) {
        throw new Error('Please use an image up to 24 megapixels, with neither side larger than 32,768 pixels.');
      }
    }

    // Reject active or remotely referenced SVG content before creating any image URL.
    // Every accepted SVG is subsequently rasterized; raw SVG never enters the page.
    function safeSvg(text) {
      if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text)) {
        throw new Error('This SVG contains an external definition. Please export a self-contained SVG or PNG.');
      }
      var parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
      var root = parsed.documentElement;
      if (!root || root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg' || parsed.querySelector('parsererror')) {
        throw new Error('This SVG is not valid. Please export it again or upload a PNG.');
      }
      var blocked = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'link', 'animate', 'animatemotion', 'animatetransform', 'set']);
      function rejectUnsafe() {
        throw new Error('This SVG contains scripts or linked content. Please upload a self-contained SVG or PNG.');
      }
      function checkCss(value) {
        // Escapes can conceal CSS keywords and remote URLs; keep the accepted subset simple.
        if (/[\\@]/.test(value)) rejectUnsafe();
        value = value.replace(/\/\*[\s\S]*?\*\//g, '');
        var withoutLocalUrls = value.replace(/url\(\s*['"]?#[A-Za-z_][\w:.-]*['"]?\s*\)/gi, '');
        if (/url\s*\(|(?:expression|image-set)\s*\(/i.test(withoutLocalUrls)) rejectUnsafe();
      }
      [root].concat(Array.from(root.querySelectorAll('*'))).forEach(function (node) {
        if (blocked.has(node.localName.toLowerCase())) rejectUnsafe();
        if (node.namespaceURI !== 'http://www.w3.org/2000/svg') rejectUnsafe();
        if (node.localName.toLowerCase() === 'style') checkCss(node.textContent);
        Array.from(node.attributes).forEach(function (attribute) {
          var name = attribute.name.toLowerCase();
          var localName = attribute.localName.toLowerCase();
          var value = attribute.value.trim();
          if (/^on/.test(name) || name === 'xml:base') rejectUnsafe();
          if (localName === 'href' || localName === 'src') {
            if (value && !/^#[A-Za-z_][\w:.-]*$/.test(value) && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(value)) rejectUnsafe();
          }
          if (name === 'style' || /url\s*\(|\\/i.test(value)) checkCss(value);
        });
      });
      var width = parseFloat(root.getAttribute('width'));
      var height = parseFloat(root.getAttribute('height'));
      if (Number.isFinite(width) && Number.isFinite(height)) validateDimensions(width, height);
      var viewBox = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      if ((!Number.isFinite(width) || !Number.isFinite(height)) && viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
        // Give SVGs with only a viewBox an explicit raster size with the same aspect ratio.
        var ratio = Math.min(1, MAX_TEXTURE_EDGE / Math.max(viewBox[2], viewBox[3]));
        root.setAttribute('width', String(Math.max(1, Math.round(viewBox[2] * ratio))));
        root.setAttribute('height', String(Math.max(1, Math.round(viewBox[3] * ratio))));
      }
      return new XMLSerializer().serializeToString(root);
    }

    function checkRasterHeader(bytes, type) {
      // Reject oversized source dimensions before asking the browser to allocate a bitmap.
      var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (type === 'image/png' && bytes.length >= 24) {
        validateDimensions(view.getUint32(16), view.getUint32(20));
      } else if (type === 'image/jpeg') {
        var cursor = 2;
        while (cursor + 3 < bytes.length) {
          if (bytes[cursor++] !== 255) break;
          while (bytes[cursor] === 255) cursor += 1;
          var marker = bytes[cursor++];
          if (marker === 217 || marker === 218) break;
          if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
          if (cursor + 2 > bytes.length) break;
          var length = view.getUint16(cursor);
          if (length < 2 || cursor + length > bytes.length) break;
          if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) {
            validateDimensions(view.getUint16(cursor + 5), view.getUint16(cursor + 3));
            break;
          }
          cursor += length;
        }
      } else if (type === 'image/webp') {
        var offset = 12;
        while (offset + 8 <= bytes.length) {
          var chunk = String.fromCharCode.apply(null, bytes.slice(offset, offset + 4));
          var size = view.getUint32(offset + 4, true);
          var data = offset + 8;
          if (data + size > bytes.length) break;
          if (chunk === 'VP8X' && size >= 10) {
            validateDimensions(1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16), 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16));
            break;
          }
          if (chunk === 'VP8L' && size >= 5 && bytes[data] === 47) {
            validateDimensions(1 + bytes[data + 1] + ((bytes[data + 2] & 63) << 8), 1 + (bytes[data + 2] >> 6) + (bytes[data + 3] << 2) + ((bytes[data + 4] & 15) << 10));
            break;
          }
          if (chunk === 'VP8 ' && size >= 10) {
            validateDimensions(view.getUint16(data + 6, true) & 16383, view.getUint16(data + 8, true) & 16383);
            break;
          }
          offset = data + size + (size % 2);
        }
      }
    }

    async function readArtwork(file, signal) {
      if (!file || !file.size) throw new Error('Please choose an image file that is not empty.');
      if (file.size > MAX_FILE_BYTES) throw new Error('That file is larger than 8 MB. Please upload a smaller image.');
      var declaredType = (file.type || '').toLowerCase().split(';')[0];
      if (declaredType && !['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(declaredType)) {
        throw new Error('Please choose a PNG, JPEG, WebP or SVG logo.');
      }
      var bytes = new Uint8Array(await file.arrayBuffer());
      assertCurrent(signal);
      var detectedType = '';
      if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) detectedType = 'image/png';
      else if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) detectedType = 'image/jpeg';
      else if (bytes.length >= 12 && String.fromCharCode.apply(null, bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode.apply(null, bytes.slice(8, 12)) === 'WEBP') detectedType = 'image/webp';
      var blob;
      if (!detectedType) {
        var text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch (error) { throw new Error('The file contents do not match a supported image format.'); }
        blob = new Blob([safeSvg(text)], { type: 'image/svg+xml' });
        detectedType = 'image/svg+xml';
      } else {
        checkRasterHeader(bytes, detectedType);
        blob = new Blob([bytes], { type: detectedType });
      }
      if (declaredType && declaredType !== detectedType) throw new Error('The file format does not match its contents. Please export the logo again.');
      assertCurrent(signal);
      var url = objectUrl(blob);
      try {
        var original = await loadImage(url, signal);
        assertCurrent(signal);
        validateDimensions(original.naturalWidth, original.naturalHeight);
        var scale = Math.min(1, MAX_TEXTURE_EDGE / Math.max(original.naturalWidth, original.naturalHeight));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(original.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(original.naturalHeight * scale));
        var context = canvas.getContext('2d');
        if (!context) throw new Error('Your browser could not prepare the image. Please try another browser.');
        context.drawImage(original, 0, 0, canvas.width, canvas.height);
        var data = canvas.toDataURL('image/png');
        var raster = await loadImage(data, signal);
        return { image: raster, data: data };
      } finally { revoke(url); }
    }

    function pressed(selector, attribute, value) {
      all(selector).forEach(function (button) { button.setAttribute('aria-pressed', String(button.getAttribute(attribute) === value)); });
    }

    function normalizedColor(value) {
      return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
    }

    function readableInk(color) {
      function luminance(hex) {
        var values = [1, 3, 5].map(function (offset) {
          var channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
          return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
        });
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      }
      var background = luminance(color);
      var dark = '#193c35';
      var light = '#fffdf5';
      var darkLuminance = luminance(dark);
      var lightLuminance = luminance(light);
      var darkContrast = (Math.max(background, darkLuminance) + 0.05) / (Math.min(background, darkLuminance) + 0.05);
      var lightContrast = (Math.max(background, lightLuminance) + 0.05) / (Math.min(background, lightLuminance) + 0.05);
      return darkContrast >= lightContrast ? dark : light;
    }

    function renderFallback() {
      if (!fallback) return;
      [byId('fallback-product'), byId('fallback-product-carton')].filter(Boolean).forEach(function (node) { node.textContent = design.productName; });
      all('#fallback-band, [data-fallback-accent]').forEach(function (node) { node.setAttribute('fill', design.accent); });
      all('[data-fallback-paper]').forEach(function (node) {
        node.setAttribute('fill', node.dataset.fallbackPaper === 'carton' ? design.packagingColor : design.labelColor);
      });
      all('[data-fallback-paper-text], #fallback-product, #fallback-product-carton, [data-fallback-placeholder]').forEach(function (node) {
        var carton = node.dataset.fallbackPaperText === 'carton' || node.id === 'fallback-product-carton' ||
          (node.hasAttribute('data-fallback-placeholder') && node.parentElement && node.parentElement.querySelector('#fallback-logo-carton'));
        node.setAttribute('fill', readableInk(carton ? design.packagingColor : design.labelColor));
      });
      all('[data-fallback-accent-text]').forEach(function (node) { node.setAttribute('fill', readableInk(design.accent)); });
      all('[data-fallback-placeholder]').forEach(function (node) { node.style.display = design.logo ? 'none' : ''; });
      fallbackLogoNodes.forEach(function (node) {
        if (logoData) {
          node.setAttribute('href', logoData);
          node.setAttribute('preserveAspectRatio', 'xMidYMid meet');
          node.style.display = '';
          var bounds = fallbackLogoBounds.get(node);
          var width = bounds.width * design.logoScale;
          var height = bounds.height * design.logoScale;
          node.setAttribute('x', String(bounds.x + (bounds.width - width) / 2));
          node.setAttribute('y', String(bounds.y + (bounds.height - height) / 2 + design.logoOffsetY * bounds.height));
          node.setAttribute('width', String(width));
          node.setAttribute('height', String(height));
        } else { node.removeAttribute('href'); node.removeAttribute('xlink:href'); node.style.display = 'none'; }
      });
    }

    function syncInputs() {
      if (byId('product-name')) byId('product-name').value = design.productName;
      if (byId('logo-scale')) byId('logo-scale').value = String(Math.round(design.logoScale * 100));
      if (byId('logo-position')) byId('logo-position').value = String(Math.round(design.logoOffsetY * 100));
      syncSliderLabels();
      pressed('[data-packaging]', 'data-packaging', packaging);
      pressed('[data-accent]', 'data-accent', design.accent);
      pressed('[data-bottle]', 'data-bottle', design.bottleFinish);
      pressed('[data-cap]', 'data-cap', design.capFinish);
      pressed('[data-label-style]', 'data-label-style', design.labelStyle);
      pressed('[data-surface-finish]', 'data-surface-finish', design.surfaceFinish);
      pressed('[data-view]', 'data-view', selectedView);
      syncColors();
      syncCameraButtons();
    }

    function syncColors() {
      [['packaging-color', 'packagingColor'], ['label-color', 'labelColor'], ['cap-color', 'capColor'], ['bottle-color', 'bottleColor']].forEach(function (config) {
        var input = byId(config[0]);
        if (input) input.value = design[config[1]];
        var output = byId(config[0] + '-value');
        if (output) output.textContent = design[config[1]].toUpperCase();
      });
      all('[data-packaging-color]').forEach(function (button) {
        button.setAttribute('aria-pressed', String(normalizedColor(button.dataset.packagingColor) === design.packagingColor));
      });
      if (byId('link-label-color')) byId('link-label-color').checked = linkedLabel;
      var darkLabel = readableInk(design.labelColor) === '#fffdf5';
      var darkCarton = readableInk(design.packagingColor) === '#fffdf5';
      var darkPaper = darkLabel || darkCarton;
      if (byId('colour-hint')) byId('colour-hint').textContent = darkLabel !== darkCarton
        ? 'Check your logo on both backgrounds, or match the label to the carton.'
        : darkPaper ? 'Tip: use a light logo on dark packaging. You can try the light demo logo.'
        : 'Your logo keeps its original colours.';
      if (byId('sample-logo-light')) byId('sample-logo-light').hidden = !darkPaper;
      syncAvailability();
    }

    function syncCameraButtons() {
      if (byId('auto-rotate')) {
        byId('auto-rotate').setAttribute('aria-pressed', String(autoRotate));
        byId('auto-rotate').setAttribute('aria-label', autoRotate ? 'Stop automatic rotation' : 'Start automatic rotation');
      }
      if (byId('orbit-mode')) byId('orbit-mode').setAttribute('aria-pressed', String(orbitMode));
      syncAvailability();
    }

    function syncSliderLabels() {
      if (byId('logo-scale-value')) byId('logo-scale-value').textContent = Math.round(design.logoScale * 100) + '%';
      if (byId('logo-position-value')) {
        var offset = Math.round(design.logoOffsetY * 100);
        byId('logo-position-value').textContent = offset === 0 ? 'Center' : Math.abs(offset) + '% ' + (offset < 0 ? 'up' : 'down');
      }
    }

    function syncThumbnail(name) {
      var preview = byId('logo-preview');
      var thumbContainer = byId('logo-thumb');
      var thumb = thumbContainer && (thumbContainer.tagName === 'IMG' ? thumbContainer : thumbContainer.querySelector('img'));
      if (preview) preview.hidden = !design.logo;
      if (thumb) {
        if (logoData) { thumb.src = logoData; thumb.alt = name || 'Your logo'; }
        else { thumb.removeAttribute('src'); thumb.alt = ''; }
      }
      if (byId('logo-filename')) byId('logo-filename').textContent = name || '';
      if (byId('mobile-upload-label')) byId('mobile-upload-label').textContent = design.logo ? 'Replace your logo' : 'Upload your logo';
    }

    function syncAvailability() {
      var unavailable = sceneState !== 'ready';
      all('[data-packaging], [data-bottle], [data-cap], [data-label-style], [data-surface-finish], [data-view], #rotate-left, #rotate-right, #reset-view, #cap-color, #bottle-color').forEach(function (button) {
        button.disabled = unavailable;
        if (sceneState === 'fallback') button.title = 'This control needs the 3D preview. Logo, text and color remain available below.';
        else button.removeAttribute('title');
      });
      [['tilt-up', 'tiltBy'], ['tilt-down', 'tiltBy'], ['zoom-in', 'zoomBy'], ['zoom-out', 'zoomBy'], ['auto-rotate', 'setAutoRotate'], ['orbit-mode', 'setOrbitMode']].forEach(function (config) {
        var control = byId(config[0]);
        if (!control) return;
        var unsupported = !scene || typeof scene[config[1]] !== 'function';
        control.disabled = unavailable || unsupported || (config[0] === 'auto-rotate' && reducedMotion.matches);
        if (config[0] === 'auto-rotate' && reducedMotion.matches) control.title = 'Automatic rotation is off because your device prefers reduced motion.';
        else if (unavailable || unsupported) control.title = 'This control needs the 3D preview.';
        else control.removeAttribute('title');
      });
      var labelInput = byId('label-color');
      if (labelInput) {
        labelInput.disabled = linkedLabel || (sceneState === 'fallback' && !all('[data-fallback-paper="label"]').length);
        if (linkedLabel) labelInput.title = 'Turn off linked colors to choose a separate label color.';
        else labelInput.removeAttribute('title');
      }
      var paperUnavailable = sceneState === 'fallback' && !all('[data-fallback-paper="carton"]').length;
      all('#packaging-color, [data-packaging-color], #link-label-color').forEach(function (control) {
        control.disabled = paperUnavailable;
        if (paperUnavailable) control.title = 'Package colors need the 3D preview in this browser.';
        else control.removeAttribute('title');
      });
      if (fullscreenButton) {
        fullscreenButton.disabled = !previewShell;
        fullscreenButton.title = previewExpanded ? 'Close expanded preview' : 'Expand preview';
      }
      if (downloadButton) {
        downloadButton.disabled = exporting || sceneState === 'loading' || (sceneState === 'fallback' && !fallback);
        downloadButton.setAttribute('aria-busy', String(exporting));
      }
    }

    function setSceneState(next) {
      if (destroyed || (sceneFailed && next === 'ready')) return;
      sceneState = next;
      document.body.dataset.scene = next;
      if (fallback) {
        fallback.setAttribute('aria-hidden', String(next === 'ready'));
        fallback.style.display = next === 'ready' ? 'none' : '';
      }
      syncAvailability();
    }

    function useFallback() {
      if (destroyed || sceneFailed) return;
      sceneFailed = true;
      autoRotate = false;
      orbitMode = false;
      designVersion += 1;
      invalidateDownload();
      if (scene && typeof scene.destroy === 'function') scene.destroy();
      scene = null;
      syncCameraButtons();
      setSceneState('fallback');
      renderFallback();
      status(studioStatus, fallback
        ? '3D is unavailable in this browser. You can still add your logo, edit the name and color, and download a flat preview.'
        : '3D is unavailable in this browser. Please try another browser to preview and download your concept.', true);
    }

    function updateDesign() {
      if (destroyed) return;
      designVersion += 1;
      invalidateDownload();
      if (updateFrame) return;
      updateFrame = requestAnimationFrame(function () {
        updateFrame = 0;
        renderFallback();
        if (scene && !sceneFailed) {
          try { scene.update(Object.assign({}, design)); }
          catch (error) { useFallback(); }
        }
      });
    }

    function callScene(method, value) {
      if (sceneState !== 'ready' || !scene || typeof scene[method] !== 'function') return false;
      designVersion += 1;
      invalidateDownload();
      cameraCommandDepth += 1;
      try { scene[method](value); return true; }
      catch (error) { useFallback(); return false; }
      finally { cameraCommandDepth -= 1; }
    }

    function setAutoRotation(enabled) {
      enabled = Boolean(enabled) && !reducedMotion.matches;
      if (enabled === autoRotate) { syncCameraButtons(); return; }
      if (callScene('setAutoRotate', enabled)) autoRotate = enabled;
      else autoRotate = false;
      if (autoRotate) { selectedView = ''; pressed('[data-view]', 'data-view', selectedView); }
      syncCameraButtons();
    }

    function setOrbitMode(enabled) {
      if (callScene('setOrbitMode', Boolean(enabled))) orbitMode = Boolean(enabled);
      else orbitMode = false;
      syncCameraButtons();
    }

    function moveCamera(method, value) {
      setAutoRotation(false);
      selectedView = '';
      pressed('[data-view]', 'data-view', '');
      callScene(method, value);
    }

    async function chooseLogo(file, name, existingController) {
      var generation = ++uploadGeneration;
      if (uploadAbort && uploadAbort !== existingController) uploadAbort.abort();
      var controller = existingController || new AbortController();
      uploadAbort = controller;
      if (dropzone) dropzone.setAttribute('aria-busy', 'true');
      status(uploadStatus, 'Preparing your logo…');
      try {
        var result = await readArtwork(file, controller.signal);
        if (generation !== uploadGeneration || destroyed) return;
        design.logo = result.image;
        logoData = result.data;
        syncThumbnail(name || file.name);
        updateDesign();
        status(uploadStatus, (/demo logo/i.test(name || '') ? 'Demo logo added.' : 'Your logo is ready.') + ' Your artwork stays in this browser.');
      } catch (error) {
        if (generation !== uploadGeneration || destroyed || error.name === 'AbortError') return;
        status(uploadStatus, error.message || 'The logo could not be opened. Your previous logo is unchanged.', true);
      } finally {
        if (generation === uploadGeneration && !destroyed && dropzone) dropzone.setAttribute('aria-busy', 'false');
      }
    }

    function removeLogo(message) {
      uploadGeneration += 1;
      if (uploadAbort) uploadAbort.abort();
      uploadAbort = null;
      design.logo = null;
      logoData = '';
      if (fileInput) fileInput.value = '';
      if (dropzone) dropzone.setAttribute('aria-busy', 'false');
      syncThumbnail('');
      updateDesign();
      status(uploadStatus, message || 'Logo removed. Add another whenever you are ready.');
    }

    listen(fileInput, 'change', function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (file) chooseLogo(file);
    });
    if (fileInput) fileInput.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
    listen(byId('mobile-upload'), 'click', function () { if (fileInput) fileInput.click(); });
    // A label already opens its associated file input. Add a click handler only for other markup.
    if (dropzone && dropzone.tagName !== 'LABEL') {
      listen(dropzone, 'click', function (event) { if (fileInput && event.target !== fileInput) fileInput.click(); });
    }
    listen(dropzone, 'keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (fileInput) fileInput.click(); }
    });
    ['dragenter', 'dragover'].forEach(function (event) {
      listen(dropzone, event, function (event) {
        event.preventDefault();
        dropzone.dataset.dragging = 'true';
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      });
    });
    listen(dropzone, 'dragleave', function (event) {
      if (!event.relatedTarget || !dropzone.contains(event.relatedTarget)) delete dropzone.dataset.dragging;
    });
    listen(dropzone, 'drop', function (event) {
      event.preventDefault();
      delete dropzone.dataset.dragging;
      var files = event.dataTransfer && event.dataTransfer.files;
      if (!files || !files.length) { status(uploadStatus, 'Drop an image file here. Links and folders are not supported.', true); return; }
      if (files.length !== 1) { status(uploadStatus, 'Please add one logo at a time.', true); return; }
      chooseLogo(files[0]);
    });
    listen(byId('logo-remove'), 'click', function () { removeLogo(); });

    function bindSampleLogo(buttonId, asset, caption) {
      listen(byId(buttonId), 'click', async function () {
        uploadGeneration += 1;
        var generation = uploadGeneration;
        if (uploadAbort) uploadAbort.abort();
        var controller = new AbortController();
        uploadAbort = controller;
        status(uploadStatus, 'Opening the demo logo…');
        try {
          var sampleUrl = new URL('assets/' + asset, document.baseURI);
          if (sampleUrl.origin !== location.origin) throw new Error('The demo logo is unavailable. Please upload your own logo.');
          var response = await fetch(sampleUrl.href, { signal: controller.signal, credentials: 'same-origin' });
          if (!response.ok) throw new Error('The demo logo is unavailable. Please upload your own logo.');
          var sample = await response.blob();
          if (generation !== uploadGeneration || destroyed) return;
          await chooseLogo(new File([sample], asset, { type: 'image/svg+xml' }), caption, controller);
        } catch (error) {
          if (generation === uploadGeneration && !destroyed && error.name !== 'AbortError') status(uploadStatus, error.message || 'The demo logo is unavailable.', true);
        }
      });
    }
    bindSampleLogo('sample-logo', 'sample-logo.svg', 'Demo logo');
    bindSampleLogo('sample-logo-light', 'sample-logo-light.svg', 'Light demo logo');

    listen(byId('product-name'), 'input', function (event) {
      design.productName = event.target.value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 42).trim() || DEFAULTS.productName;
      updateDesign();
    });
    if (byId('product-name')) byId('product-name').maxLength = 42;
    listen(byId('logo-scale'), 'input', function (event) {
      design.logoScale = Math.max(65, Math.min(150, Number(event.target.value) || 100)) / 100;
      syncSliderLabels(); updateDesign();
    });
    listen(byId('logo-position'), 'input', function (event) {
      design.logoOffsetY = Math.max(-15, Math.min(15, Number(event.target.value) || 0)) / 100;
      syncSliderLabels(); updateDesign();
    });
    [
      ['accent', 'accent', function (value) { return /^#[0-9a-f]{6}$/i.test(value); }],
      ['bottle', 'bottleFinish', function (value) { return ['amber', 'white', 'custom'].includes(value); }],
      ['cap', 'capFinish', function (value) { return ['ivory', 'black', 'custom'].includes(value); }],
      ['label-style', 'labelStyle', function (value) { return ['signature', 'minimal'].includes(value); }],
      ['surface-finish', 'surfaceFinish', function (value) { return ['matte', 'satin'].includes(value); }],
    ].forEach(function (config) {
      all('[data-' + config[0] + ']').forEach(function (button) {
        listen(button, 'click', function () {
          if (button.disabled) return;
          var value = button.getAttribute('data-' + config[0]);
          if (!config[2](value)) return;
          design[config[1]] = value;
          pressed('[data-' + config[0] + ']', 'data-' + config[0], value);
          updateDesign();
        });
      });
    });
    function changePackagingColor(value) {
      var color = normalizedColor(value);
      if (!color) return;
      design.packagingColor = color;
      if (linkedLabel) design.labelColor = color;
      syncColors(); updateDesign();
    }
    all('[data-packaging-color]').forEach(function (button) {
      listen(button, 'click', function () {
        if (!button.disabled) changePackagingColor(button.dataset.packagingColor);
      });
    });
    listen(byId('packaging-color'), 'input', function (event) { if (!event.target.disabled) changePackagingColor(event.target.value); });
    listen(byId('label-color'), 'input', function (event) {
      var color = normalizedColor(event.target.value);
      if (event.target.disabled || linkedLabel || !color) return;
      design.labelColor = color;
      syncColors(); updateDesign();
    });
    listen(byId('link-label-color'), 'change', function (event) {
      linkedLabel = event.target.checked;
      if (linkedLabel) design.labelColor = design.packagingColor;
      syncColors(); updateDesign();
    });
    [['cap-color', 'capColor', 'capFinish', 'cap'], ['bottle-color', 'bottleColor', 'bottleFinish', 'bottle']].forEach(function (config) {
      listen(byId(config[0]), 'input', function (event) {
        var color = normalizedColor(event.target.value);
        if (event.target.disabled || !color) return;
        design[config[1]] = color;
        design[config[2]] = 'custom';
        pressed('[data-' + config[3] + ']', 'data-' + config[3], 'custom');
        syncColors(); updateDesign();
      });
    });
    all('[data-packaging]').forEach(function (button) {
      listen(button, 'click', function () {
        if (button.disabled || !['set', 'bottle', 'carton'].includes(button.dataset.packaging)) return;
        packaging = button.dataset.packaging;
        pressed('[data-packaging]', 'data-packaging', packaging);
        callScene('setPackaging', packaging);
      });
    });
    all('[data-view]').forEach(function (button) {
      listen(button, 'click', function () {
        if (button.disabled || !viewNames.includes(button.dataset.view)) return;
        setAutoRotation(false);
        selectedView = button.dataset.view;
        pressed('[data-view]', 'data-view', selectedView);
        callScene('setView', selectedView);
      });
    });
    listen(byId('rotate-left'), 'click', function () { moveCamera('rotateBy', -Math.PI / 8); });
    listen(byId('rotate-right'), 'click', function () { moveCamera('rotateBy', Math.PI / 8); });
    listen(byId('tilt-up'), 'click', function () { moveCamera('tiltBy', Math.PI / 12); });
    listen(byId('tilt-down'), 'click', function () { moveCamera('tiltBy', -Math.PI / 12); });
    listen(byId('zoom-in'), 'click', function () { moveCamera('zoomBy', 1.15); });
    listen(byId('zoom-out'), 'click', function () { moveCamera('zoomBy', 1 / 1.15); });
    listen(byId('auto-rotate'), 'click', function () { setAutoRotation(!autoRotate); });
    listen(byId('orbit-mode'), 'click', function () { setOrbitMode(!orbitMode); });
    listen(mount, 'innovita:rotate', function (event) {
      var detail = event.detail || {};
      if (typeof detail.autoRotate === 'boolean') autoRotate = detail.autoRotate;
      if (typeof detail.orbitMode === 'boolean') orbitMode = detail.orbitMode;
      if (detail.source === 'auto') {
        // Continuous animation has no new design revision. It stops before PNG capture.
        selectedView = '';
        pressed('[data-view]', 'data-view', '');
        return;
      }
      selectedView = detail.source === 'control' && viewNames.includes(detail.view) ? detail.view : '';
      pressed('[data-view]', 'data-view', selectedView);
      if (!cameraCommandDepth) { designVersion += 1; invalidateDownload(); }
      syncCameraButtons();
    });
    listen(byId('reset-view'), 'click', function () {
      setAutoRotation(false);
      selectedView = 'angle'; pressed('[data-view]', 'data-view', selectedView);
      callScene('resetView');
    });
    function onReducedMotionChange() {
      if (reducedMotion.matches) setAutoRotation(false);
      syncCameraButtons();
    }
    if (reducedMotion.addEventListener) listen(reducedMotion, 'change', onReducedMotionChange);
    else {
      reducedMotion.addListener(onReducedMotionChange);
      cleanup.push(function () { reducedMotion.removeListener(onReducedMotionChange); });
    }
    function syncExpandedPreview() {
      if (!fullscreenButton) return;
      fullscreenButton.setAttribute('aria-pressed', String(previewExpanded));
      fullscreenButton.setAttribute('aria-label', previewExpanded ? 'Close expanded preview' : 'Expand preview');
      fullscreenButton.title = previewExpanded ? 'Close expanded preview' : 'Expand preview';
      if (fullscreenText) fullscreenText.textContent = previewExpanded ? 'Close expanded preview' : fullscreenLabel;
      syncAvailability();
    }

    function focusablePreviewControls() {
      if (!previewShell) return [];
      return Array.from(previewShell.querySelectorAll('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]')).filter(function (node) {
        if (node.disabled || node.tabIndex < 0 || node.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
        var style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && node.getClientRects().length > 0;
      });
    }

    function focusPreviewControl(node) {
      if (!node || typeof node.focus !== 'function') return;
      try { node.focus({ preventScroll: true }); }
      catch (error) { node.focus(); }
    }

    function restoreAttribute(node, name, value) {
      if (value === null) node.removeAttribute(name);
      else node.setAttribute(name, value);
    }

    function setPreviewExpanded(expanded, silent) {
      if (!previewShell || previewExpanded === expanded) return;
      if (expanded) {
        expansionSnapshot = {
          role: previewShell.getAttribute('role'),
          modal: previewShell.getAttribute('aria-modal'),
          label: previewShell.getAttribute('aria-label'),
          labelledBy: previewShell.getAttribute('aria-labelledby'),
          tabIndex: previewShell.getAttribute('tabindex'),
          expandedClass: previewShell.classList.contains('is-expanded'),
          bodyState: document.body.getAttribute('data-preview-expanded'),
          bodyOverflow: document.body.style.getPropertyValue('overflow'),
          bodyOverflowPriority: document.body.style.getPropertyPriority('overflow'),
        };
        previewExpanded = true;
        previewShell.classList.add('is-expanded');
        previewShell.setAttribute('role', 'dialog');
        previewShell.setAttribute('aria-modal', 'true');
        previewShell.setAttribute('aria-label', 'Expanded product preview');
        previewShell.removeAttribute('aria-labelledby');
        previewShell.setAttribute('tabindex', '-1');
        document.body.setAttribute('data-preview-expanded', 'true');
        document.body.style.setProperty('overflow', 'hidden');
        syncExpandedPreview();
        var controls = focusablePreviewControls();
        focusPreviewControl(controls.includes(fullscreenButton) ? fullscreenButton : controls[0] || previewShell);
        if (!silent) status(studioStatus, 'Expanded preview is ready. Press Escape to close.');
      } else {
        previewExpanded = false;
        var previous = expansionSnapshot;
        expansionSnapshot = null;
        if (previous) {
          previewShell.classList.toggle('is-expanded', previous.expandedClass);
          restoreAttribute(previewShell, 'role', previous.role);
          restoreAttribute(previewShell, 'aria-modal', previous.modal);
          restoreAttribute(previewShell, 'aria-label', previous.label);
          restoreAttribute(previewShell, 'aria-labelledby', previous.labelledBy);
          restoreAttribute(previewShell, 'tabindex', previous.tabIndex);
          restoreAttribute(document.body, 'data-preview-expanded', previous.bodyState);
          if (previous.bodyOverflow) document.body.style.setProperty('overflow', previous.bodyOverflow, previous.bodyOverflowPriority);
          else document.body.style.removeProperty('overflow');
        }
        syncExpandedPreview();
        if (!destroyed) focusPreviewControl(fullscreenButton);
        if (!silent) status(studioStatus, sceneState === 'fallback'
          ? 'Your flat preview is ready. Continue editing or download your preview.'
          : sceneState === 'ready' ? 'Your concept is ready. Continue editing or download your preview.' : 'Preparing your preview…');
      }
    }

    listen(fullscreenButton, 'click', function () {
      if (!fullscreenButton.disabled) setPreviewExpanded(!previewExpanded);
    });
    listen(document, 'keydown', function (event) {
      if (!previewExpanded) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        setPreviewExpanded(false);
        return;
      }
      if (event.key !== 'Tab') return;
      var controls = focusablePreviewControls();
      if (!controls.length) { event.preventDefault(); focusPreviewControl(previewShell); return; }
      var activeIndex = controls.indexOf(document.activeElement);
      if (event.shiftKey && activeIndex <= 0) {
        event.preventDefault(); focusPreviewControl(controls[controls.length - 1]);
      } else if (!event.shiftKey && (activeIndex < 0 || activeIndex === controls.length - 1)) {
        event.preventDefault(); focusPreviewControl(controls[0]);
      }
    }, true);
    listen(document, 'focusin', function (event) {
      if (!previewExpanded || previewShell.contains(event.target)) return;
      focusPreviewControl(focusablePreviewControls()[0] || previewShell);
    });
    listen(byId('reset-design'), 'click', function () {
      removeLogo('Design reset. Add your logo to start again.');
      setAutoRotation(false); setOrbitMode(false);
      design = Object.assign({}, DEFAULTS);
      packaging = 'set'; selectedView = 'angle'; linkedLabel = true;
      syncInputs(); updateDesign();
      callScene('setPackaging', packaging); callScene('resetView');
      if (sceneState === 'ready') status(studioStatus, 'Your concept is ready. Add your logo to make it yours.');
    });

    async function fallbackPng() {
      if (!fallback) throw new Error('A preview is unavailable in this browser. Please try a browser with 3D support.');
      renderFallback();
      var copy = fallback.cloneNode(true);
      copy.removeAttribute('id'); copy.removeAttribute('class'); copy.removeAttribute('hidden');
      copy.style.display = 'block'; copy.style.position = 'static';
      copy.style.width = ''; copy.style.height = ''; copy.style.opacity = '1'; copy.style.visibility = 'visible';
      copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      var originals = [fallback].concat(Array.from(fallback.querySelectorAll('*')));
      var clones = [copy].concat(Array.from(copy.querySelectorAll('*')));
      var styles = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-anchor', 'dominant-baseline', 'opacity', 'visibility', 'display'];
      originals.forEach(function (original, index) {
        var computed = getComputedStyle(original);
        styles.forEach(function (property) {
          var value = computed.getPropertyValue(property);
          if (value) {
            // Computed SVG paint references can become document-absolute URLs.
            // Keep local gradients local when serializing the standalone image.
            value = value.replace(/url\(["']?[^)"']*#([^\s)"']+)["']?\)/gi, 'url(#$1)');
            clones[index].style.setProperty(property, value);
          }
        });
      });
      copy.style.display = 'block'; copy.style.visibility = 'visible';
      var box = fallback.viewBox && fallback.viewBox.baseVal;
      var ratio = box && box.width > 0 && box.height > 0 ? box.width / box.height : 1.2;
      var width = 1600;
      var height = Math.max(1, Math.round(width / ratio));
      if (height > 2000) { width = Math.round(width * 2000 / height); height = 2000; }
      copy.setAttribute('width', String(width)); copy.setAttribute('height', String(height));
      var url = objectUrl(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
      try {
        var image = await loadImage(url);
        assertCurrent();
        var canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        var context = canvas.getContext('2d');
        if (!context) throw new Error('PNG export is unavailable in this browser.');
        context.fillStyle = '#f5f7f0'; context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        return await new Promise(function (resolve, reject) {
          canvas.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error('The PNG could not be created. Please try again.')); }, 'image/png');
        });
      } finally { revoke(url); }
    }

    listen(downloadButton, 'click', async function () {
      if (exporting || downloadButton.disabled) return;
      setAutoRotation(false);
      exporting = true;
      var exportVersion = designVersion;
      syncAvailability();
      if (downloadText) downloadText.textContent = 'Preparing PNG…';
      status(studioStatus, 'Preparing your concept preview…');
      try {
        if (updateFrame) { cancelAnimationFrame(updateFrame); updateFrame = 0; }
        if (sceneState === 'ready' && scene) scene.update(Object.assign({}, design));
        var blob = sceneState === 'ready' && scene ? await scene.exportPng() : await fallbackPng();
        assertCurrent();
        if (!(blob instanceof Blob) || !blob.size) throw new Error('The PNG could not be created. Please try again.');
        if (exportVersion !== designVersion) throw new Error('Your design changed while the PNG was being prepared. Download again to save the latest version.');
        invalidateDownload();
        var url = objectUrl(blob);
        lastDownloadUrl = url;
        var link = document.createElement('a');
        link.href = url;
        var name = design.productName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'your-brand';
        link.download = 'innovita-' + name + '-concept.png';
        var readyLink = byId('download-ready');
        if (readyLink) {
          readyLink.href = url;
          readyLink.download = link.download;
          readyLink.replaceChildren();
          var exportThumb = document.createElement('img');
          exportThumb.src = url;
          exportThumb.alt = 'Your exported packaging concept';
          var exportText = document.createElement('span');
          exportText.textContent = 'PNG ready · Save image';
          readyLink.append(exportThumb, exportText);
          readyLink.hidden = false;
        }
        document.body.appendChild(link); link.click(); link.remove();
        status(studioStatus, 'Your PNG is ready. This is a concept preview for discussion.');
      } catch (error) {
        if (!destroyed && error.name !== 'AbortError') status(studioStatus, error.message || 'The PNG could not be downloaded. Please try again.', true);
      } finally {
        exporting = false;
        if (!destroyed) { if (downloadText) downloadText.textContent = downloadLabel; syncAvailability(); }
      }
    });

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      setPreviewExpanded(false, true);
      uploadGeneration += 1;
      if (uploadAbort) uploadAbort.abort();
      if (updateFrame) cancelAnimationFrame(updateFrame);
      if (scene) scene.destroy();
      invalidateDownload();
      cleanup.forEach(function (remove) { remove(); });
      timers.forEach(function (timer) { clearTimeout(timer); });
      pendingUrls.forEach(function (url) { URL.revokeObjectURL(url); });
      pendingUrls.clear();
      delete mount.dataset.controllerMounted;
    }
    listen(window, 'pagehide', function (event) { if (!event.persisted) destroy(); });
    syncInputs(); syncThumbnail(''); renderFallback(); invalidateDownload(); setSceneState('loading'); syncExpandedPreview();
    try {
      if (!window.InnovitaStudioScene || typeof window.InnovitaStudioScene.create !== 'function') { useFallback(); return; }
      scene = window.InnovitaStudioScene.create({
        mount: mount,
        design: Object.assign({}, design),
        onReady: function () {
          // The renderer may call onReady synchronously inside create().
          queueMicrotask(function () {
            if (destroyed || sceneFailed) return;
            setSceneState('ready');
            callScene('setPackaging', packaging); callScene('setView', selectedView);
            if (scene && typeof scene.setOrbitMode === 'function') callScene('setOrbitMode', orbitMode);
            if (scene && typeof scene.setAutoRotate === 'function') callScene('setAutoRotate', autoRotate && !reducedMotion.matches);
            if (sceneFailed) return;
            syncCameraButtons();
            updateDesign();
            status(studioStatus, 'Your concept is ready. Add your logo to make it yours.');
          });
        },
        onError: useFallback,
      });
      if (sceneFailed && scene) { scene.destroy(); scene = null; }
    } catch (error) { useFallback(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
