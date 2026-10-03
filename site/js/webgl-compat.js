(() => {
  const UNUSABLE_EXTENSIONS = ["EXT_disjoint_timer_query", "EXT_disjoint_timer_query_webgl2"];
  const BASIS = { 2: "vec2(0.0, 1.0)", 3: "vec3(0.0, 1.0, 2.0)", 4: "vec4(0.0, 1.0, 2.0, 3.0)" };

  function declarations(source, pattern) {
    return [...source.matchAll(pattern)];
  }

  function rewriteDynamicIndexing(source) {
    const integers = new Set(declarations(source, /\bint\s+(\w+)\s*;/g).map(match => match[1]));
    if (!integers.size) return source;
    const sizes = new Map(declarations(source, /\b(mat|vec)([234])\s+(\w+)\s*;/g).map(match => [match[3], { kind: match[1], size: Number(match[2]) }]));
    return source.replace(/\b(\w+)((?:\[\d+\])?)\[(\w+)\](?!\s*=[^=])/g, (whole, name, column, index) => {
      const info = sizes.get(name);
      if (!info || !integers.has(index) || (info.kind === "mat") !== Boolean(column)) return whole;
      const size = info.size;
      return `dot(${name}${column}, vec${size}(equal(vec${size}(float(${index})), ${BASIS[size]})))`;
    });
  }

  function patch(prototype) {
    if (!prototype) return;
    const getSupportedExtensions = prototype.getSupportedExtensions;
    const getExtension = prototype.getExtension;
    const shaderSource = prototype.shaderSource;
    const compileShader = prototype.compileShader;
    const sources = new WeakMap();

    prototype.getSupportedExtensions = function () {
      return (getSupportedExtensions.call(this) || []).filter(name => !UNUSABLE_EXTENSIONS.includes(name));
    };
    prototype.getExtension = function (name) {
      return UNUSABLE_EXTENSIONS.includes(name) ? null : getExtension.call(this, name);
    };
    prototype.shaderSource = function (shader, source) {
      sources.set(shader, source);
      return shaderSource.call(this, shader, source);
    };
    prototype.compileShader = function (shader) {
      compileShader.call(this, shader);
      const source = sources.get(shader);
      if (!source || this.getShaderParameter(shader, this.COMPILE_STATUS)) return;
      if (!/Index expression/i.test(this.getShaderInfoLog(shader) || "")) return;
      const rewritten = rewriteDynamicIndexing(source);
      if (rewritten === source) return;
      shaderSource.call(this, shader, rewritten);
      compileShader.call(this, shader);
    };
  }

  patch(window.WebGLRenderingContext?.prototype);
  patch(window.WebGL2RenderingContext?.prototype);
})();
