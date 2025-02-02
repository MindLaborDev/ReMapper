// deno-lint-ignore-file no-explicit-any adjacent-overload-signatures
import { path, fs, compress } from './deps.ts';
import { Note } from './note.ts';
import { Wall } from './wall.ts';
import { Event, EventInternals } from './event.ts';
import { CustomEventInternals } from './custom_event.ts';
import { Environment, EnvironmentInternals, Geometry, GeometryMaterial } from './environment.ts';
import { copy, isEmptyObject, jsonGet, jsonPrune, jsonRemove, jsonSet, sortObjects, Vec3, setDecimals, RMLog, parseFilePath, RMJson } from './general.ts';
import { AnimationInternals } from './animation.ts';
import { OptimizeSettings } from './anim_optimizer.ts';
import { ENV_NAMES, MODS, settingsHandler, DIFFS, FILENAME, FILEPATH } from './constants.ts';

type PostProcessFn<T> = (object: T, diff: Difficulty) => void;
type DIFFPATH = FILEPATH<DIFFS>
type DIFFNAME = FILENAME<DIFFS>

type WrappedClass = Note | Wall | CustomEventInternals.BaseEvent

export function getClassFromJson<T extends WrappedClass>(json: Record<string, any>, target: { new(): T }) {
    const proto = Object.getPrototypeOf(json);

    if (proto instanceof target) return proto;
    else {
        const obj = new target().import(json) as T;
        Object.setPrototypeOf(json, obj);
        return obj
    }
}

function wrapClassArray<T extends WrappedClass>(source: Record<string, any>[], target: { new(): T }) {
    return new Proxy(source, {
        get(object, prop) {
            if (!isNaN(parseInt(prop as any))) return getClassFromJson(object[prop as any], target);
            else return object[prop as any];
        },

        set(object, prop, value) {
            if (!isNaN(parseInt(prop as any))) {
                object[parseInt(prop as any)] = value.json;
            }
            else object[prop as any] = value;
            return true;
        }
    }) as T[]
}

export class Difficulty {
    json: Record<string, any> = {};
    diffSet: Record<string, any> = {};
    diffSetMap: Record<string, any> = {};
    mapFile: DIFFPATH;
    relativeMapFile: DIFFNAME;

    private internalNotes: Note[];
    private internalWalls: Wall[];
    private internalCustomEvents: CustomEventInternals.BaseEvent[] | undefined;

    private postProcesses = new Map<unknown[] | undefined, PostProcessFn<unknown>[]>();
    private registerProcessors() {
        this.addPostProcess(undefined, reduceDecimalsPostProcess);
    }

    private setJsonWrapperArr<T extends WrappedClass>(obj: { new(): T }, jsonPath: string, internalPath: string, value: any) {
        jsonSet(this.json, jsonPath, value);
        (this as any)[internalPath] = wrapClassArray(jsonGet(this.json, jsonPath), obj);
    }

    private setWrapperArr<T extends WrappedClass>(obj: { new(): T }, jsonPath: string, internalPath: string, value: T[]) {
        this.setJsonWrapperArr(obj, jsonPath, internalPath, [])
        value.forEach((x, i) => (this as any)[internalPath][i] = x );
    }

    /**
     * Creates a difficulty. Can be used to access various information and the map data.
     * Will set the active difficulty to this.
     * @param {String} input Filename for the input.
     * @param {String} input Filename for the output. If left blank, input will be used.
     */
    constructor(input: DIFFPATH, output?: DIFFPATH) {
        const parsedInput = parseFilePath(input, ".dat");
        const parsedOutput = parseFilePath(output ?? input, ".dat");

        // If the path contains a separator of any kind, use it instead of the default "Info.dat"
        info.load(parsedOutput.dir ? path.join(parsedOutput.dir, "Info.dat") : undefined);

        this.mapFile = parsedOutput.path as DIFFPATH;
        this.relativeMapFile = parsedOutput.name as DIFFNAME;
        this.json = JSON.parse(Deno.readTextFileSync(parsedInput.path));

        info.json._difficultyBeatmapSets.forEach((set: Record<string, any>) => {
            set._difficultyBeatmaps.forEach((setmap: Record<string, any>) => {
                if (this.relativeMapFile === setmap._beatmapFilename) {
                    this.diffSet = set;
                    this.diffSetMap = setmap;
                }
            })
        })

        if (this.diffSet === undefined) throw new Error(`The difficulty ${parsedOutput.name} does not exist in your Info.dat`)

        this.internalNotes = wrapClassArray(this.notesJson, Note);
        this.internalWalls = wrapClassArray(this.wallsJson, Wall);
        for (let i = 0; i < this.events.length; i++) this.events[i] = new Event().import(this.events[i] as Record<string, any>);
        if (this.customEventsJson) this.internalCustomEvents = wrapClassArray(this.customEventsJson, CustomEventInternals.BaseEvent)
        if (this.rawEnvironment !== undefined)
            for (let i = 0; i < this.rawEnvironment.length; i++) this.rawEnvironment[i] = new EnvironmentInternals.BaseEnvironment().import(this.rawEnvironment[i] as Record<string, any>);

        if (this.version === undefined) this.version = "2.2.0";

        activeDiff = this;

        this.registerProcessors();
    }

    optimize(optimize: OptimizeSettings = new OptimizeSettings()) {
        const optimizeAnimation = (animation: AnimationInternals.BaseAnimation) => {
            animation.optimize(undefined, optimize)
        };

        this.notes.forEach(e => optimizeAnimation(e.animate));
        this.walls.forEach(e => optimizeAnimation(e.animate));
        this.customEvents.filter(e => e instanceof CustomEventInternals.AnimateTrack).forEach(e => optimizeAnimation((e as CustomEventInternals.AnimateTrack).animate));

        // TODO: Optimize point definitions
    }

    /**
     * 
     * @param object The object to process. If undefined, will just process the difficulty
     * @param fn 
     */
    addPostProcess<T>(object: T[] | undefined, fn: PostProcessFn<T>) {
        let list = this.postProcesses.get(object)

        if (!list) {
            list = []
            this.postProcesses.set(object, list);
        }

        // idc am lazy
        list.push(fn as any);
    }

    /**
     * 
     * @param object The object to process. If undefined, will run all 
     */
    doPostProcess<T = unknown>(object: T[] | undefined = undefined) {
        type Tuple = [unknown[] | undefined, PostProcessFn<unknown>[]];

        const functionsMap: Tuple[] = object === undefined
            ? Array.from(this.postProcesses.entries()) :
            [[object, this.postProcesses.get(object)!]]

        functionsMap.forEach(tuple => {
            const arr = tuple[0]
            const functions = tuple[1]

            if (arr === undefined) {
                functions.forEach(fn => fn(undefined, this))
            } else {
                arr.forEach(i => functions.forEach(fn => fn(i, this)))
            }
        })
    }

    /** 
     * Saves the difficulty.
     * @param {String} diffName Filename for the save. If left blank, the beatmap file name will be used for the save.
     */
    save(diffName?: DIFFPATH) {
        if (diffName) diffName = parseFilePath(diffName, ".dat").path as DIFFPATH;
        else diffName = this.mapFile;

        const outputJSON = {} as Record<string, any>;

        Object.keys(this.json).forEach(x => {
            if (
                x === "_events"
            ) {
                outputJSON[x] = [];
            }
            else if (x === "_customData") Object.keys(this.json[x]).forEach(y => {
                if (!outputJSON[x]) outputJSON[x] = {};
                if (
                    y === "_environment"
                ) {
                    outputJSON[x][y] = [];
                }
                else outputJSON[x][y] = copy(this.json[x][y]);
            })
            else outputJSON[x] = copy(this.json[x]);
        })

        // this.doPostProcess()

        outputJSON._notes.forEach((x: Record<string, any>) => {
            const note = getClassFromJson(x, Note);
            if (settings.forceJumpsForNoodle && note.isGameplayModded) {
                note.NJS = x.NJS;
                note.offset = x.offset;
            }
            jsonPrune(note.json);
        })

        // Walls
        outputJSON._obstacles.forEach((x: Record<string, any>) => {
            const wall = getClassFromJson(x, Wall);
            if (settings.forceJumpsForNoodle && wall.isGameplayModded) {
                wall.NJS = x.NJS;
                wall.offset = x.offset;
            }
            jsonPrune(wall.json);
        })

        // Events
        this.events.forEach(x => { outputJSON._events.push(copy(x.json)) });

        // Environment
        if (this.rawEnvironment) this.rawEnvironment.forEach(x => {
            const json = copy(x.json);
            jsonRemove(json, "_group");
            outputJSON._customData._environment.push(json);
        })

        sortObjects(outputJSON._events, "_time");
        sortObjects(outputJSON._notes, "_time");
        sortObjects(outputJSON._obstacles, "_time");
        if (this.customEventsJson) sortObjects(outputJSON._customData._customEvents, "_time");

        info.save();
        RMJson.save();
        Deno.writeTextFileSync(diffName, JSON.stringify(outputJSON, null, 0));
        RMLog(`${diffName} successfully saved!`);
    }

    /**
     * Add/remove a requirement from the difficulty.
     * @param {String} requirement 
     * @param {Boolean} required True by default, set to false to remove the requirement.
     */
    require(requirement: MODS, required = true) {
        const requirements: Record<string, any> = {};

        let requirementsArr = this.requirements;
        if (requirementsArr === undefined) requirementsArr = [];
        requirementsArr.forEach(x => {
            requirements[x] = true;
        })
        requirements[requirement] = required;

        requirementsArr = [];
        for (const key in requirements) {
            if (requirements[key] === true) requirementsArr.push(key);
        }
        this.requirements = requirementsArr;
    }

    /**
     * Add/remove a suggestion from the difficulty.
     * @param {String} suggestion 
     * @param {Boolean} suggested True by default, set to false to remove the suggestion.
     */
    suggest(suggestion: MODS, suggested = true) {
        const suggestions: Record<string, any> = {};

        let suggestionsArr = this.suggestions;
        if (suggestionsArr === undefined) suggestionsArr = [];
        suggestionsArr.forEach(x => {
            suggestions[x] = true;
        })
        suggestions[suggestion] = suggested;

        suggestionsArr = [];
        for (const key in suggestions) {
            if (suggestions[key] === true) suggestionsArr.push(key);
        }
        this.suggestions = suggestionsArr;
    }

    readonly settings = new Proxy(new settingsHandler(this), {
        get(object, property) {
            const objValue = (object as any)[property] as string | [string, Record<string, any>];
            const path = typeof objValue === "string" ? objValue : objValue[0];
            const diff = (object as any)["diff"] as Difficulty;

            return diff.rawSettings[path];
        },

        set(object, property, value) {
            const objValue = (object as any)[property] as string | [string, Record<string, any>];
            const path = typeof objValue === "string" ? objValue : objValue[0];
            const diff = (object as any)["diff"] as Difficulty;

            if (typeof objValue !== "string") value = objValue[1][value];
            diff.pruneInput(diff.rawSettings, path, value);
            return true;
        }
    });

    private pruneInput(object: Record<string, any>, property: string, value: any) {
        jsonSet(object, property, value);
        if (!isEmptyObject(value)) jsonPrune(this.diffSetMap);
    }

    private colorArrayToTuple(array: Vec3) { return { r: array[0], g: array[1], b: array[2] } }

    // Info.dat
    get NJS(): number { return jsonGet(this.diffSetMap, "_noteJumpMovementSpeed") }
    get offset(): number { return jsonGet(this.diffSetMap, "_noteJumpStartBeatOffset") }
    get fileName(): string { return jsonGet(this.diffSetMap, "_beatmapFilename") }
    get diffSetName(): string { return jsonGet(this.diffSet, "_beatmapCharacteristicName") }
    get name(): string { return jsonGet(this.diffSetMap, "_difficulty") }
    get diffRank(): number { return jsonGet(this.diffSetMap, "_difficultyRank") }
    get requirements(): string[] { return jsonGet(this.diffSetMap, "_customData._requirements", []) }
    get suggestions(): string[] { return jsonGet(this.diffSetMap, "_customData._suggestions", []) }
    get rawSettings(): Record<string, any> { return jsonGet(this.diffSetMap, "_customData._settings", {}) }
    get warnings(): string[] { return jsonGet(this.diffSetMap, "_customData._warnings") }
    get information(): string[] { return jsonGet(this.diffSetMap, "_customData._information") }
    get label(): string { return jsonGet(this.diffSetMap, "_customData._difficultyLabel") }
    get editorOffset(): number { return jsonGet(this.diffSetMap, "_customData._editorOffset") }
    get editorOldOffset(): number { return jsonGet(this.diffSetMap, "_customData._editorOldOffset") }
    get colorLeft(): Vec3 { return jsonGet(this.diffSetMap, "_customData._colorLeft") }
    get colorRight(): Vec3 { return jsonGet(this.diffSetMap, "_customData._colorRight") }
    get lightColorLeft(): Vec3 { return jsonGet(this.diffSetMap, "_customData._envColorLeft") }
    get lightColorRight(): Vec3 { return jsonGet(this.diffSetMap, "_customData._envColorRight") }
    get boostColorLeft(): Vec3 { return jsonGet(this.diffSetMap, "_customData._envColorLeftBoost") }
    get boostColorRight(): Vec3 { return jsonGet(this.diffSetMap, "_customData._envColorRightBoost") }
    get obstacleColor(): Vec3 { return jsonGet(this.diffSetMap, "_customData._obstacleColor") }

    set NJS(value) { this.pruneInput(this.diffSetMap, "_noteJumpMovementSpeed", value) }
    set offset(value) { this.pruneInput(this.diffSetMap, "_noteJumpStartBeatOffset", value) }
    set fileName(value) { this.pruneInput(this.diffSetMap, "_beatmapFilename", value) }
    set diffSetName(value) { this.pruneInput(this.diffSet, "_beatmapCharacteristicName", value) }
    set name(value) { this.pruneInput(this.diffSetMap, "_difficulty", value) }
    set diffRank(value) { this.pruneInput(this.diffSetMap, "_difficultyRank", value) }
    set requirements(value) { this.pruneInput(this.diffSetMap, "_customData._requirements", value) }
    set suggestions(value) { this.pruneInput(this.diffSetMap, "_customData._suggestions", value) }
    set rawSettings(value) { this.pruneInput(this.diffSetMap, "_customData._settings", value) }
    set warnings(value) { this.pruneInput(this.diffSetMap, "_customData._warnings", value) }
    set information(value) { this.pruneInput(this.diffSetMap, "_customData._information", value) }
    set label(value) { this.pruneInput(this.diffSetMap, "_customData._difficultyLabel", value) }
    set editorOffset(value) { this.pruneInput(this.diffSetMap, "_customData._editorOffset", value) }
    set editorOldOffset(value) { this.pruneInput(this.diffSetMap, "_customData._editorOldOffset", value) }
    set colorLeft(value) { this.pruneInput(this.diffSetMap, "_customData._colorLeft", this.colorArrayToTuple(value)) }
    set colorRight(value) { this.pruneInput(this.diffSetMap, "_customData._colorRight", this.colorArrayToTuple(value)) }
    set lightColorLeft(value) { this.pruneInput(this.diffSetMap, "_customData._envColorLeft", this.colorArrayToTuple(value)) }
    set lightColorRight(value) { this.pruneInput(this.diffSetMap, "_customData._envColorRight", this.colorArrayToTuple(value)) }
    set boostColorLeft(value) { this.pruneInput(this.diffSetMap, "_customData._envColorLeftBoost", this.colorArrayToTuple(value)) }
    set boostColorRight(value) { this.pruneInput(this.diffSetMap, "_customData._envColorRightBoost", this.colorArrayToTuple(value)) }
    set obstacleColor(value) { this.pruneInput(this.diffSetMap, "_customData._obstacleColor", this.colorArrayToTuple(value)) }

    // Map
    get version(): string { return jsonGet(this.json, "_version") }
    get notes(): Note[] { return this.internalNotes }
    get notesJson(): Record<string, any>[] { return jsonGet(this.json, "_notes") }
    get walls(): Wall[] { return this.internalWalls }
    get wallsJson(): Record<string, any>[] { return jsonGet(this.json, "_obstacles" )}
    get events(): EventInternals.AbstractEvent[] { return jsonGet(this.json, "_events") }
    get waypoints(): any[] { return jsonGet(this.json, "_waypoints") }
    get customData(): Record<string, any> { return jsonGet(this.json, "_customData", {}) }
    get customEvents() { 
        if (!this.internalCustomEvents) this.customEvents = [];
        return this.internalCustomEvents as CustomEventInternals.BaseEvent[];
    }
    get customEventsJson(): CustomEventInternals.BaseEvent[] { return jsonGet(this.json, "_customData._customEvents") }
    animateTracks(fn: (arr: CustomEventInternals.AnimateTrack[]) => void) {
        const arr = this.customEvents.filter(x => x instanceof CustomEventInternals.AnimateTrack) as CustomEventInternals.AnimateTrack[]
        fn(arr);
        this.customEvents = this.customEvents.filter(x => !(x instanceof CustomEventInternals.AnimateTrack)).concat(arr);
    }
    assignPathAnimations(fn: (arr: CustomEventInternals.AssignPathAnimation[]) => void) {
        const arr = this.customEvents.filter(x => x instanceof CustomEventInternals.AssignPathAnimation) as CustomEventInternals.AssignPathAnimation[]
        fn(arr);
        this.customEvents = this.customEvents.filter(x => !(x instanceof CustomEventInternals.AssignPathAnimation)).concat(arr);
    }
    assignTrackParents(fn: (arr: CustomEventInternals.AssignTrackParent[]) => void) {
        const arr = this.customEvents.filter(x => x instanceof CustomEventInternals.AssignTrackParent) as CustomEventInternals.AssignTrackParent[]
        fn(arr);
        this.customEvents = this.customEvents.filter(x => !(x instanceof CustomEventInternals.AssignTrackParent)).concat(arr);
    }
    assignPlayerToTracks(fn: (arr: CustomEventInternals.AssignPlayerToTrack[]) => void) {
        const arr = this.customEvents.filter(x => x instanceof CustomEventInternals.AssignPlayerToTrack) as CustomEventInternals.AssignPlayerToTrack[]
        fn(arr);
        this.customEvents = this.customEvents.filter(x => !(x instanceof CustomEventInternals.AssignPlayerToTrack)).concat(arr);
    }
    assignFogTracks(fn: (arr: CustomEventInternals.AssignFogTrack[]) => void) {
        const arr = this.customEvents.filter(x => x instanceof CustomEventInternals.AssignFogTrack) as CustomEventInternals.AssignFogTrack[]
        fn(arr);
        this.customEvents = this.customEvents.filter(x => !(x instanceof CustomEventInternals.AnimateTrack)).concat(arr);
    }
    abstractEvents(fn: (arr: CustomEventInternals.AbstractEvent[]) => void) {
        const arr = this.customEvents.filter(x => x instanceof CustomEventInternals.AbstractEvent) as CustomEventInternals.AbstractEvent[]
        fn(arr);
        this.customEvents = this.customEvents.filter(x => !(x instanceof CustomEventInternals.AbstractEvent)).concat(arr);
    }
    get pointDefinitions(): Record<string, any>[] { return jsonGet(this.json, "_customData._pointDefinitions", []) }
    get geoMaterials(): Record<string, GeometryMaterial> { return jsonGet(this.json, "_customData._materials", {}) }
    get rawEnvironment(): EnvironmentInternals.BaseEnvironment[] { return jsonGet(this.json, "_customData._environment", []) }
    environment(fn: (arr: Environment[]) => void) {
        const arr = this.rawEnvironment.filter(x => x instanceof Environment) as Environment[]
        fn(arr);
        this.rawEnvironment = this.rawEnvironment.filter(x => !(x instanceof Environment)).concat(arr);
    }
    geometry(fn: (arr: Geometry[]) => void) {
        const arr = this.rawEnvironment.filter(x => x instanceof Geometry) as Geometry[]
        fn(arr);
        this.rawEnvironment = this.rawEnvironment.filter(x => !(x instanceof Geometry)).concat(arr);
    }

    set version(value) { jsonSet(this.json, "_version", value) }
    set notesJson(value) { this.setJsonWrapperArr(Note, "_notes", "internalNotes", value) }
    set notes(value) { this.setWrapperArr(Note, "_notes", "internalNotes", value) }
    set wallsJson(value) { this.setJsonWrapperArr(Wall, "_obstacles", "internalWalls", value) }
    set walls(value) { this.setWrapperArr(Wall, "_obstacles", "internalWalls", value) }
    set events(value) { jsonSet(this.json, "_events", value) }
    set waypoints(value) { jsonSet(this.json, "_waypoints", value) }
    set customData(value) { jsonSet(this.json, "_customData", value) }
    set customEventsJson(value) { this.setJsonWrapperArr(CustomEventInternals.BaseEvent, "_customData._customEvents", "internalCustomEvents", value) }
    set customEvents(value) { this.setWrapperArr(CustomEventInternals.BaseEvent, "_customData._customEvents", "internalCustomEvents", value) }
    set pointDefinitions(value) { jsonSet(this.json, "_customData._pointDefinitions", value) }
    set geoMaterials(value) { jsonSet(this.json, "_customData._materials", value) }
    set rawEnvironment(value) { jsonSet(this.json, "_customData._environment", value) }
}

export class Info {
    json: Record<string, any> = {};
    fileName = "Info.dat";

    load(path?: string) {
        const fileName = path ? parseFilePath(path, ".dat").path : this.fileName;
        this.json = JSON.parse(Deno.readTextFileSync(fileName));
        this.fileName = fileName;
    }

    /**
     * Saves the Info.dat
     */
    save() {
        if (!this.json) throw new Error("The Info object has not been loaded.");
        Deno.writeTextFileSync(this.fileName, JSON.stringify(this.json, null, 2));
    }

    get version() { return jsonGet(this.json, "_version") }
    get name() { return jsonGet(this.json, "_songName") }
    get subName() { return jsonGet(this.json, "_songSubName") }
    get authorName() { return jsonGet(this.json, "_songAuthorName") }
    get mapper() { return jsonGet(this.json, "_levelAuthorName") }
    get BPM() { return jsonGet(this.json, "_beatsPerMinute") }
    get previewStart() { return jsonGet(this.json, "_previewStartTime") }
    get previewDuration() { return jsonGet(this.json, "_previewDuration") }
    get songOffset() { return jsonGet(this.json, "_songTimeOffset") }
    get shuffle() { return jsonGet(this.json, "_shuffle") }
    get shufflePeriod() { return jsonGet(this.json, "_shufflePeriod") }
    get coverFileName() { return jsonGet(this.json, "_coverImageFilename") }
    get songFileName() { return jsonGet(this.json, "_songFilename") }
    get environment() { return jsonGet(this.json, "_environmentName") }
    get environment360() { return jsonGet(this.json, "_allDirectionsEnvironmentName") }
    get customData() { return jsonGet(this.json, "_customData") }
    get editors() { return jsonGet(this.json, "_customData._editors") }
    get contributors() { return jsonGet(this.json, "_customData._contributors") }
    get customEnvironment() { return jsonGet(this.json, "_customData._customEnvironment") }
    get customEnvironmentHash() { return jsonGet(this.json, "_customData._customEnvironmentHash") }

    set version(value: string) { jsonSet(this.json, "_version", value) }
    set name(value: string) { jsonSet(this.json, "_songName", value) }
    set subName(value: string) { jsonSet(this.json, "_songSubName", value) }
    set authorName(value: string) { jsonSet(this.json, "_songAuthorName", value) }
    set mapper(value: string) { jsonSet(this.json, "_levelAuthorName", value) }
    set BPM(value: number) { jsonSet(this.json, "_beatsPerMinute", value) }
    set previewStart(value: number) { jsonSet(this.json, "_previewStartTime", value) }
    set previewDuration(value: number) { jsonSet(this.json, "_previewDuration", value) }
    set songOffset(value: number) { jsonSet(this.json, "_songTimeOffset", value) }
    set shuffle(value: boolean) { jsonSet(this.json, "_shuffle", value) }
    set shufflePeriod(value: number) { jsonSet(this.json, "_shufflePeriod", value) }
    set coverFileName(value: string) { jsonSet(this.json, "_coverImageFilename", value) }
    set songFileName(value: string) { jsonSet(this.json, "_songFilename", value) }
    set environment(value: ENV_NAMES) { jsonSet(this.json, "_environmentName", value) }
    set environment360(value: string) { jsonSet(this.json, "_allDirectionsEnvironmentName", value) }
    set customData(value: Record<string, any>) { jsonSet(this.json, "_customData", value) }
    set editors(value: Record<string, any>) { jsonSet(this.json, "_customData._editors", value) }
    set contributors(value: Record<string, any>[]) { jsonSet(this.json, "_customData._contributors", value) }
    set customEnvironment(value: string) { jsonSet(this.json, "_customData._customEnvironment", value) }
    set customEnvironmentHash(value: string) { jsonSet(this.json, "_customData._customEnvironmentHash", value) }
}

export const info = new Info();
export let activeDiff: Difficulty;
export const settings = {
    forceJumpsForNoodle: true,
    decimals: 7 as number | undefined
}

/**
 * Set the difficulty that objects are being created for.
 * @param {Object} diff 
 */
export function activeDiffSet(diff: Difficulty) { activeDiff = diff }

/**
 * Get the active difficulty, ensuring that it is indeed active.
 * @returns {Object}
 */
export function activeDiffGet() {
    if (activeDiff) return activeDiff;
    else throw new Error("There is currently no loaded difficulty.");
}

function reduceDecimalsPostProcess(_: never, diff: Difficulty) {
    if (!settings.decimals) return;
    const mapJson = diff.json;
    reduceDecimalsInObject(mapJson);

    function reduceDecimalsInObject(json: Record<string, any>) {
        for (const key in json) {
            // deno-lint-ignore no-prototype-builtins
            if (!json.hasOwnProperty(key)) return;
            const element = json[key];

            if (typeof element === "number") {
                json[key] = setDecimals(element, settings.decimals as number);
            } else if (element instanceof Object) {
                reduceDecimalsInObject(element)
            }
        }
    }
}

/**
 * Automatically zip the map, including only necessary files.
 * @param {String[]} excludeDiffs Difficulties to exclude.
 * @param {String} zipName Name of the zip (don't include ".zip"). Uses folder name if undefined.
 */
export function exportZip(excludeDiffs: FILENAME<DIFFS>[] = [], zipName?: string) {
    if (!info.json) throw new Error("The Info object has not been loaded.");

    const absoluteInfoFileName = info.fileName === "Info.dat" ? Deno.cwd() + `\\${info.fileName}` : info.fileName;
    const workingDir = path.parse(absoluteInfoFileName).dir;
    const exportInfo = copy(info.json);
    let files: string[] = [];
    function pushFile(file: string) {
        const dir = workingDir + `\\${file}`;
        if (fs.existsSync(dir)) files.push(dir);
    }

    pushFile(exportInfo._songFilename);
    if (exportInfo._coverImageFilename !== undefined) pushFile(exportInfo._coverImageFilename);

    for (let s = 0; s < exportInfo._difficultyBeatmapSets.length; s++) {
        const set = exportInfo._difficultyBeatmapSets[s];
        for (let m = 0; m < set._difficultyBeatmaps.length; m++) {
            const map = set._difficultyBeatmaps[m];
            let passed = true;
            excludeDiffs.forEach(d => {
                if (map._beatmapFilename === parseFilePath(d, ".dat").path) {
                    set._difficultyBeatmaps.splice(m, 1);
                    m--;
                    passed = false;
                }
            })

            if (passed) pushFile(map._beatmapFilename);
        }

        if (set._difficultyBeatmaps.length === 0) {
            exportInfo._difficultyBeatmapSets.splice(s, 1);
            s--;
        }
    }

    zipName ??= `${path.parse(workingDir).name}`;
    zipName = `${zipName}.zip`;
    const tempDir = Deno.makeTempDirSync();
    const tempInfo = tempDir + `\\Info.dat`;
    files.push(tempInfo);
    Deno.writeTextFileSync(tempInfo, JSON.stringify(exportInfo, null, 0));

    files = files.map(x => x = `"${x}"`);
    zipName = zipName.replaceAll(" ", "_");
    compressZip();
    async function compressZip() {
        await compress(files, zipName, { overwrite: true });
        RMLog(`${zipName} has been zipped!`);
    }
}

/**
 * Transfer the visual aspect of maps to other difficulties.
 * More specifically modded walls, custom events, point definitions, environment enhancements, and lighting events.
 * @param {Array} diffs The difficulties being effected.
 * @param {Function} forDiff A function to run over each difficulty.
 * The activeDiff keyword will change to be each difficulty running during this function.
 * Be mindful that the external difficulties don't have an input/output structure,
 * so new pushed notes for example may not be cleared on the next run and would build up.
 */
export function transferVisuals(diffs: DIFFPATH[], forDiff?: (diff: Difficulty) => void) {
    const startActive = activeDiff as Difficulty;

    diffs.forEach(x => {
        const workingDiff = new Difficulty(parseFilePath(x, ".dat").path as DIFFPATH);

        workingDiff.rawEnvironment = startActive.rawEnvironment;
        workingDiff.pointDefinitions = startActive.pointDefinitions;
        workingDiff.customEvents = startActive.customEvents;
        workingDiff.events = startActive.events;

        for (let y = 0; y < workingDiff.walls.length; y++) {
            const obstacle = workingDiff.walls[y];
            if (obstacle.isModded) {
                workingDiff.walls.splice(y, 1);
                y--;
            }
        }

        startActive.walls.forEach(y => { if (y.isModded) workingDiff.walls.push(y) })

        if (forDiff !== undefined) forDiff(workingDiff);
        workingDiff.save();
    })

    activeDiffSet(startActive);
}