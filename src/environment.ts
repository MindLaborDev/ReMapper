// deno-lint-ignore-file no-explicit-any adjacent-overload-signatures no-namespace
import { combineAnimations, AnimationInternals } from './animation.ts';
import { activeDiffGet } from './beatmap.ts';
import { copy, Vec3, ColorType } from './general.ts';
import { CustomEvent } from './custom_event.ts';
import { GEO_TYPE, LOOKUP, GEO_SHADER } from './constants.ts';

let envCount = 0;

export namespace EnvironmentInternals {
    export class BaseEnvironment {
        json: Record<string, any> = {};

        /**
        * Create an environment object using JSON.
        * @param {Object} json 
        * @returns {Environment}
        */
        import(json: Record<string, any>) {
            this.json = json;
            return this;
        }

        /**
         * Push this environment object to the difficulty
         */
        push() {
            activeDiffGet().rawEnvironment.push(copy(this));
            return this;
        }

        get duplicate() { return this.json._duplicate }
        get active() { return this.json._active }
        get scale() { return this.json._scale }
        get position() { return this.json._position }
        get localPosition() { return this.json._localPosition }
        get rotation() { return this.json._rotation }
        get localRotation() { return this.json._localRotation }
        get lightID() { return this.json._lightID }
        get track() { return this.json._track }
        get group() { return this.json._group }
        get animationProperties() {
            const returnObj: any = {};
            if (this.position !== undefined) returnObj._position = this.position;
            if (this.localPosition !== undefined) returnObj._localPosition = this.localPosition;
            if (this.rotation !== undefined) returnObj._rotation = this.rotation;
            if (this.localRotation !== undefined) returnObj._localRotation = this.localRotation;
            if (this.scale !== undefined) returnObj._scale = this.scale
            return returnObj;
        }

        set duplicate(value: number) { this.json._duplicate = value }
        set active(value: boolean) { this.json._active = value }
        set scale(value: Vec3) { this.json._scale = value }
        set position(value: Vec3) { this.json._position = value }
        set localPosition(value: Vec3) { this.json._localPosition = value }
        set rotation(value: Vec3) { this.json._rotation = value }
        set localRotation(value: Vec3) { this.json._localRotation = value }
        set lightID(value: number) { this.json._lightID = value }
        set track(value: string) { this.json._track = value }
        set group(value: string) { this.json._group = value }
    }
}

export class Environment extends EnvironmentInternals.BaseEnvironment {
    /**
     * Environment object for ease of creation and additional tools.
     * @param {String} id 
     * @param {String} lookupMethod 
     */
    constructor(id?: string, lookupMethod: LOOKUP | undefined = undefined) {
        super();
        id ??= "";
        lookupMethod ??= "Contains";
        this.id = id;
        this.lookupMethod = lookupMethod;
    }

    get id() { return this.json._id }
    get lookupMethod() { return this.json._lookupMethod }

    set id(value: string) { this.json._id = value }
    set lookupMethod(value: LOOKUP) { this.json._lookupMethod = value }
}

export class Geometry extends EnvironmentInternals.BaseEnvironment {
    json: Record<string, any> = {
        _geometry: {}
    };

    constructor(type?: GEO_TYPE, material?: GeometryMaterial | string) {
        super();
        type ??= "Cube";
        material ??= {
            _shader: "Standard"
        }
        this.type = type;
        this.material = material;
    }

    get type() { return this.json._geometry._type }
    get material() { return this.json._geometry._material }
    get collision() { return this.json._geometry._collision }

    set type(value: GEO_TYPE) { this.json._geometry._type = value }
    set material(value: GeometryMaterial | string) { this.json._geometry._material = value }
    set collision(value: boolean) { this.json._geometry._collision = value }
}

export type GeometryMaterial = RawGeometryMaterial | string
export type RawGeometryMaterial = {
    _shader: GEO_SHADER,
    _color?: ColorType,
    _track?: string,
    _shaderKeywords?: string[]
}

export function animateEnvGroup(group: string, time: number, animation: (animation: AnimationInternals.EnvironmentAnimation) => void, duration?: number, easing?: string) {
    if (activeDiffGet().rawEnvironment !== undefined) activeDiffGet().rawEnvironment.forEach(x => {
        if (x.group === group) {
            const newAnimation = new AnimationInternals.AbstractAnimation;
            animation(newAnimation);

            if (!x.track) {
                x.track = `environment_${envCount}`;
                envCount++
            }

            const event = new CustomEvent(time).animateTrack(x.track);
            if (duration) event.duration = duration;
            if (easing) event.easing = easing;

            Object.keys(newAnimation.json).forEach(key => {
                event.animate.json[key] = newAnimation.json[key]
                if (x.json[key]) event.animate.json[key] = combineAnimations(event.animate.json[key], x.json[key], key);
            })

            event.push();
        }
    })
}

export function animateEnvTrack(group: string, time: number, animation: (animation: AnimationInternals.EnvironmentAnimation) => void, duration?: number, easing?: string) {
    if (activeDiffGet().rawEnvironment !== undefined) activeDiffGet().rawEnvironment.forEach(x => {
        if (x.track === group) {
            const newAnimation = new AnimationInternals.AbstractAnimation;
            animation(newAnimation);

            const event = new CustomEvent(time).animateTrack(x.track);
            if (duration) event.duration = duration;
            if (easing) event.easing = easing;

            Object.keys(newAnimation.json).forEach(key => {
                event.animate.json[key] = newAnimation.json[key]
                if (x.json[key]) event.animate.json[key] = combineAnimations(event.animate.json[key], x.json[key], key);
            })

            event.push();
        }
    })
}