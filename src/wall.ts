// deno-lint-ignore-file adjacent-overload-signatures no-explicit-any
import { activeDiff, activeDiffGet, info } from './beatmap.ts';
import { copy, jsonPrune, isEmptyObject, getJumps, ColorType, jsonRemove } from './general.ts';
import { Animation, AnimationInternals, Track } from './animation.ts';
import { WALL } from './constants.ts';

export class Wall {
    json: any = {
        _time: 0,
        _type: 0,
        _lineIndex: 0,
        _duration: 1,
        _width: 1,
        _customData: {
            _animation: {}
        }
    };
    animate = new Animation().wallAnimation(this.animation);

    /**
     * Wall object for ease of creation.
     * @param {Number} time
     * @param {Number} duration 
     * @param {Number} type Can be left empty to create a noodle wall template.
     * @param {Number} lineIndex 
     * @param {Number} width
     */
    constructor(time?: number, duration?: number, type?: WALL, lineIndex?: number, width?: number) {
        if (time !== undefined) this.time = time;
        if (duration !== undefined) this.duration = duration;
        if (type !== undefined) this.type = type;
        else {
            this.lineIndex = 0;
            this.width = 0;
            this.scale = [1, 1, 1];
            this.position = [0, 0];
            return;
        }
        if (lineIndex !== undefined) this.lineIndex = lineIndex;
        if (width !== undefined) this.width = width;
    }

    /**
     * Create a wall using JSON.
     * @param {Object} json 
     * @returns {Note}
     */
    import(json: Record<string, any>) {
        this.json = json;
        if (this.customData === undefined) this.customData = {};
        if (this.animation === undefined) this.animation = {};
        this.animate = new Animation().wallAnimation(this.animation);
        return this;
    }

    /**
     * Push this Wall to the difficulty
     * @param clone
     * @returns 
     */
     push(clone = false) {
        activeDiff.wallsJson.push(clone ? copy(this.json) : this.json);
        return this;
    }

    /**
     * Apply an animation through the Animation class.
     * @param {Animation} animation 
     */
    importAnimation(animation: AnimationInternals.BaseAnimation) {
        this.animation = animation.json;
        this.animate = new Animation().wallAnimation(this.animation);
        return this;
    }

    get time() { return this.json._time }
    get type() { return this.json._type }
    get duration() { return this.json._duration }
    get lineIndex() { return this.json._lineIndex }
    get width() { return this.json._width }
    get customData() { return this.json._customData }
    get scale() { return this.json._customData._scale }
    get position() { return this.json._customData._position }
    get rotation() { return this.json._customData._rotation }
    get localRotation() { return this.json._customData._localRotation }
    get NJS() {
        if (this.json._customData._noteJumpMovementSpeed) return this.json._customData._noteJumpMovementSpeed;
        else return activeDiffGet().NJS;
    }
    get offset() {
        if (this.json._customData._noteJumpStartBeatOffset) return this.json._customData._noteJumpStartBeatOffset;
        else return activeDiffGet().offset;
    }
    get halfJumpDur() { return getJumps(this.NJS, this.offset, info.BPM).halfDur }
    get jumpDist() { return getJumps(this.NJS, this.offset, info.BPM).dist }
    get life() { return this.halfJumpDur * 2 + this.duration }
    get lifeStart() { return this.time - this.halfJumpDur }
    get fake() { return this.json._customData._fake }
    get interactable() { return this.json._customData._interactable }
    get track() { return new Track(this.json._customData) }
    get color() { return this.json._customData._color }
    get animation() { return this.json._customData._animation }

    set time(value: number) { this.json._time = value }
    set type(value: number) { this.json._type = value }
    set duration(value: number) { this.json._duration = value }
    set lineIndex(value: number) { this.json._lineIndex = value }
    set width(value: number) { this.json._width = value }
    set customData(value) { this.json._customData = value }
    set scale(value: number[]) { this.json._customData._scale = value }
    set position(value: number[]) { this.json._customData._position = value }
    set rotation(value: number[]) { this.json._customData._rotation = value }
    set localRotation(value: number[]) { this.json._customData._localRotation = value }
    set NJS(value: number) { this.json._customData._noteJumpMovementSpeed = value }
    set offset(value: number) { this.json._customData._noteJumpStartBeatOffset = value }
    set life(value: number) { this.duration = value - (this.halfJumpDur * 2) }
    set lifeStart(value: number) { this.time = value + this.halfJumpDur }
    set fake(value: boolean) { this.json._customData._fake = value }
    set interactable(value: boolean) { this.json._customData._interactable = value }
    set color(value: ColorType) { this.json._customData._color = value }
    set animation(value) { this.json._customData._animation = value }

    get isModded() {
        if (this.customData === undefined) return false;
        const customData = copy(this.customData);
        jsonPrune(customData);
        return !isEmptyObject(customData);
    }

    get isGameplayModded() {
        if (this.customData === undefined) return false;
        const customData = copy(this.customData);
        jsonRemove(customData, "_color");
        jsonRemove(customData, "_animation._color");
        jsonPrune(customData);
        return !isEmptyObject(customData);
    }
}