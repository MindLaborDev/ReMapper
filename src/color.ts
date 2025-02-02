import { clamp, ColorType, lerp, lerpEasing, lerpWrap } from "./general.ts";

export class Color {
  private internalValue: ColorType = [0, 0, 0, 1];
  format = "RGB";

  /**
   * @param {Array} value The value of the color.
   * @param {String} format The format of the color. Defaults to RGB.
   */
  constructor(value: ColorType, format: string) {
    if (value === undefined) value = this.internalValue;
    if (format === undefined) format = this.format;
    this.internalValue = this.processValue(value);
    this.format = format;
  }

  /**
   * Converts from one format to another.
   * @param {String} format
   * @param {Boolean} alert Option to remove alerts about already being the same format.
   */
  toFormat(format: string, alert = true) {
    if (format === "RGB") {
      if (this.format === "RGB" && alert) {
        console.warn(`The color ${this.internalValue} was already RGB!`);
      }
      if (this.format === "HSV") this.HSVtoRGB();
    }

    if (format === "HSV") {
      if (this.format === "HSV" && alert) {
        console.warn(`The color ${this.internalValue} was already HSV!`);
      }
      if (this.format === "RGB") this.RGBtoHSV();
    }
  }

  /**
   * Exports noodle ready in RGB.
   * @returns {Array}
   */
  export(): ColorType {
    this.toFormat("RGB", false);
    return this.internalValue;
  }

  private processValue(value: ColorType) {
    value = value.map((x) => clamp(x, 0)) as ColorType;
    if (value[3] === undefined) value[3] = 1;
    return value;
  }

  private HSVtoRGB() {
    const h = clamp(this.internalValue[0], 0, 1);
    const s = this.internalValue[1];
    const v = this.internalValue[2];

    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);

    let r = 0;
    let g = 0;
    let b = 0;

    switch (i % 6) {
      case 0:
        r = v, g = t, b = p;
        break;
      case 1:
        r = q, g = v, b = p;
        break;
      case 2:
        r = p, g = v, b = t;
        break;
      case 3:
        r = p, g = q, b = v;
        break;
      case 4:
        r = t, g = p, b = v;
        break;
      case 5:
        r = v, g = p, b = q;
        break;
    }
    if (this.internalValue[3]) {
      this.internalValue = [r, g, b, this.internalValue[3]];
    } else this.internalValue = [r, g, b];
    this.format = "RGB";
  }

  private RGBtoHSV() {
    const r = this.internalValue[0];
    const g = this.internalValue[1];
    const b = this.internalValue[2];

    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;

    let h = 69;
    const s = (max === 0 ? 0 : d / max);
    const v = max;

    switch (max) {
      case min:
        h = 0;
        break;
      case r:
        h = (g - b) + d * (g < b ? 6 : 0);
        h /= 6 * d;
        break;
      case g:
        h = (b - r) + d * 2;
        h /= 6 * d;
        break;
      case b:
        h = (r - g) + d * 4;
        h /= 6 * d;
        break;
    }

    if (this.internalValue[3]) {
      this.internalValue = [h, s, v, this.internalValue[3]];
    } else this.internalValue = [h, s, v];
    this.format = "HSV";
  }

  get value() {
    return this.internalValue;
  }
  set value(value) {
    this.internalValue = this.processValue(value);
  }
}

/**
 * Interpolates between a start and end color to get a color in between.
 * @param {Color} start
 * @param {Color} end
 * @param {Number} fraction
 * @param {String} easing Optional easing
 * @param {String} format Option to lerp through HSV or RGB
 */
export function lerpColor(
  start: Color,
  end: Color,
  fraction: number,
  easing = undefined,
  format?: string,
) {
  if (format !== "RGB" && format !== "HSV") format = "RGB";

  const returnFormat = start.format;
  if (easing !== undefined) fraction = lerpEasing(easing, fraction);

  const output = new Color([0, 0, 0], format);
  const newStart = new Color(start.value, start.format);
  const newEnd = new Color(end.value, end.format);

  newStart.toFormat(format, false);
  newEnd.toFormat(format, false);

  if (format === "HSV") {
    output.value[0] = lerpWrap(newStart.value[0], newEnd.value[0], fraction);
    output.value[1] = lerp(newStart.value[1], newEnd.value[1], fraction);
    output.value[2] = lerp(newStart.value[2], newEnd.value[2], fraction);
    if (newStart.value[3] || newEnd.value[3]) {
      output.value[3] = lerp(
        newStart.value[3] ? newStart.value[3] : 1,
        newEnd.value[3] ? newEnd.value[3] : 1,
        fraction,
      );
    }
  } else {
    for (let i = 0; i <= 3; i++) {
      output.value[i] = lerp(newStart.value[i], newEnd.value[i], fraction);
    }
  }

  output.toFormat(returnFormat, false);
  return output;
}
