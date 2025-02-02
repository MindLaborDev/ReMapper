// deno-lint-ignore-file no-namespace
import { activeDiff } from "./beatmap.ts";
import { Event, EventInternals, LightID } from "./event.ts";
import { arrHas, copy } from "./general.ts";

type Condition = (event: EventInternals.AbstractEvent) => boolean;
type Process = (event: EventInternals.AbstractEvent) => void;

export namespace LightRemapperInternals {
    export class BaseLightRemapper {
        conditions: Condition[] = [];
        processes: Process[] = [];

        constructor(condition?: Condition) { if (condition) this.conditions.push(condition) }

        /**
         * A condition that events must pass.
         * @param condition 
         * @returns 
         */
        addCondition = (condition: Condition) => this.conditions.push(condition);

        /**
         * A function to edit the event.
         * @param process 
         * @returns 
         */
        addProcess = (process: Process) => this.processes.push(process);

        protected returnAddCondition = (condition: Condition) => {
            this.addCondition(condition);
            return this;
        }

        protected returnAddProcess = (process: Process) => {
            this.addProcess(process);
            return this;
        }

        /**
         * Sets the type of the event.
         * @param {Number} type 
         * @returns 
         */
        setType = (type: number) => this.returnAddProcess(x => { x.type = type });

        /**
         * Multiplies the colors of the event. Applies to gradients too.
         * @param {Number} rgb 
         * @param {Number} alpha 
         * @returns 
         */
        multiplyColor = (rgb: number, alpha = 1) => this.returnAddProcess(x => {
            if (x.color) {
                x.color[0] *= rgb;
                x.color[1] *= rgb;
                x.color[2] *= rgb;
                if (x.color[3]) x.color[3] *= alpha;
            }
        })

        /**
         * Test the algorithm with some lightIDs which will be logged.
         * @param {Array} ids 
         */
        test(ids: number[]) {
            this.conditions = [];

            const event = new Event().abstract();
            event.lightID = ids;

            this.processEvents([event], true);
        }

        /**
         * Run the algorithm.
         * @param {Boolean} log Log the output JSON of each event.
         */
        run = (log = false) => this.processEvents(activeDiff.events, log);

        processEvents(events: EventInternals.AbstractEvent[], log = false) {
            events.forEach(x => {
                let passed = true;
                this.conditions.forEach(p => { if (!p(x)) passed = false });
                if (!passed) return;

                this.processes.forEach(p => { p(x) });
                if (log) console.log(x.json);
            })
        }
    }
}

export class LightRemapper extends LightRemapperInternals.BaseLightRemapper {
    private complexifyLightIDs(lightID: LightID, callback: (ids: number[]) => number[]) {
        let ids = typeof lightID === "number" ? [lightID] : lightID;
        ids = callback(ids);
        return ids.length === 1 ? ids[0] : ids;
    }

    /**
     * Events will pass if they have this type.
     * @param type 
     * @returns 
     */
    type = (type: number) => this.returnAddCondition(x => x.type === type);

    /**
     * Checks if any lightIDs on this event are in this range.
     * @param range Min and max, or use one number to be both.
     * @returns 
     */
    range = (range: number | [number, number]) => this.returnAddCondition(x => {
        if (typeof range === "number") range = [range, range];
        return isInID(x.lightID, range[0], range[1]);
    })

    /**
     * Events will pass if they have lightIDs, or contain one of the lightIDs you specify.
     * @param lightIDs 
     * @returns 
     */
    IDs = (lightIDs?: number[]) => this.returnAddCondition(x => {
        if (x.lightID) {
            if (lightIDs) {
                let passed = false;
                this.complexifyLightIDs(x.lightID, ids => {
                    if (ids.some(i => arrHas(lightIDs, i))) passed = true;
                    return ids;
                })
                return passed;
            }
            else return true;
        }
        return false;
    })

    /**
     * Sets the lightID of the event.
     * Removes some (now redundant) functions.
     * @param {Number | Array} lightID 
     * @returns 
     */
    setIDs(lightID: LightID) {
        this.addProcess(x => {
            x.lightID = lightID;
        })

        const lightOverrider = new LightRemapperInternals.BaseLightRemapper();
        lightOverrider.conditions = this.conditions;
        lightOverrider.processes = this.processes;
        return lightOverrider;
    }

    /**
     * Adds lightIDs to the event.
     * @param lightID 
     * @param initialize If false and event has no lightIDs, skip.
     * @returns 
     */
    appendIDs = (lightID: LightID, initialize = false) => this.returnAddProcess(x => {
        if (!x.lightID) {
            if (initialize) x.lightID = [];
            else return;
        }

        this.complexifyLightIDs(lightID, ids1 => {
            x.lightID = this.complexifyLightIDs(x.lightID, ids2 => {
                return ids2.concat(ids1);
            })
            return ids1;
        })
    })

    /**
     * Initialize lightIDs if event has none.
     * @param lightID 
     * @param spread If true, use lightID field as min and max to fill lightIDs in between.
     * @returns 
     */
    initIDs = (lightID: LightID, spread = false) => this.returnAddProcess(x => {
        let output: LightID = [];

        if (spread && typeof lightID === "object" && lightID.length === 2)
            for (let i = lightID[0]; i <= lightID[1]; i++) output.push(i);
        else output = lightID;

        if (!x.lightID) x.lightID = output;
    })

    /**
     * Normalizes a sequence of lightIDs to a sequence of: 1, 2, 3, 4, 5... etc.
     * @param {Number} step Differences between lightIDs.
     * @param {Number} start Start of the sequence.
     * @returns 
     */
    normalizeLinear = (step: number, start = 1) => this.returnAddProcess(x => {
        if (x.lightID) {
            x.lightID = this.complexifyLightIDs(x.lightID, ids => solveLightMap([[start, step]], ids))
        }
    })

    /**
     * Normalizes a sequence of lightIDs to a sequence of: 1, 2, 3, 4, 5... etc.
     * Accounts for differences changing at different points.
     * @param {Array} map [[start, step], [start, step]...]
     * 
     * start - The point at which the differences change.
     * 
     * step - The new differences.
     * 
     * If the sequence goes: 1, 3, 5, 6, 7, the differences change from 2 to 1 at the third number.
     * So map would look like: [[1, 2], [3, 1]]
     * @returns 
     */
    normalizeWithChanges = (map: number[][]) => this.returnAddProcess(x => {
        if (x.lightID) {
            x.lightID = this.complexifyLightIDs(x.lightID, ids => solveLightMap(map, ids))
        }
    })

    /**
     * Effects the ending sequence of lightIDs.
     * @param {Number} offset Add a number to each lightID.
     * @param {Number} step Changes the differences between each lightID.
     * @returns 
     */
    addToEnd = (offset: number, step?: number) => this.returnAddProcess(x => {
        if (x.lightID) {
            x.lightID = this.complexifyLightIDs(x.lightID, ids => {
                return ids.map(i => {
                    if (step) i = (i - 1) * step + 1;
                    return i + offset;
                });
            })
        }
    })

    /**
     * Remap lightIDs assuming the output is a sequence of 1, 2, 3, 4, 5...
     * @param {Array} map Works like map in normalizeWithChanges() but in reverse.
     * @param {Number} offset Adds a number to each lightID.
     * @returns 
     */
    remapEnd = (map: number[][], offset = 0) => this.returnAddProcess(x => {
        if (x.lightID) {
            x.lightID = this.complexifyLightIDs(x.lightID, ids => {
                applyLightMap([offset, ...map], ids);
                return ids;
            })
        }
    })
}

// Made by Rabbit cause I'm too dumb! :)
function solveLightMap(map: number[][], ids: number[]) {
    function solve(output: number, changes: number[][]) {
        let inputMapped = 0

        if (changes.length < 1) {
            return output
        }

        let currentChange, lastChange
        let currentIndex = 0
        while (true) {
            currentChange = changes[currentIndex++]

            const lastInputMapped = inputMapped

            if (!lastChange) { // implicit [0,1]
                inputMapped += currentChange[0]
            } else {
                inputMapped += lastChange[1] * (currentChange[0] - lastChange[0])
            }

            if (inputMapped > output) { // next change is too far out
                if (!lastChange) { // implicit [0,1]
                    return output
                } else {
                    return lastChange[0] + (output - lastInputMapped) / lastChange[1]
                }
            } else if (changes.length - currentIndex < 1) {
                return currentChange[0] + (output - inputMapped) / currentChange[1]
            }

            lastChange = currentChange
        }
    }

    for (let i = 0; i < ids.length; i++) {
        ids[i] = solve(ids[i], map);
    }

    return ids;
}

// This too, I cba to add type stuff here cause IDK how it works lol
function applyLightMap(map: (number | number[])[], ids: number[]) {
    map = copy(map);
    const offset = map.splice(0, 1)[0];

    // deno-lint-ignore no-explicit-any
    function apply(input: any, changes: any) {
        let output = 0;

        if (changes.length < 1) {
            return input
        }

        let currentChange, lastChange
        let currentIndex = 0

        while (true) {
            currentChange = changes[currentIndex++]

            if (currentChange[0] <= input) { // fill entire previous change
                if (!lastChange) { // implicit [0,1]
                    output += currentChange[0]
                } else {
                    output += lastChange[1] * (currentChange[0] - lastChange[0])
                }
            } else { // next change is too far out
                if (!lastChange) { // implicit [0,1]
                    return input
                } else {
                    output += lastChange[1] * (input - lastChange[0])
                    return output
                }
            }

            if (changes.length - currentIndex < 1) {
                output += currentChange[1] * (input - currentChange[0])
                return output
            }

            lastChange = currentChange
        }
    }

    for (let i = 0; i < ids.length; i++) {
        ids[i] = apply(ids[i], map) + offset;
    }
}

function isInID(lightID: LightID, start: number, end: number) {
    if (lightID === undefined) return false;
    if (typeof lightID === "object") {
        let passed = false;
        lightID.forEach(z => {
            if (z >= start && z <= end) passed = true;
        })
        if (passed) return true;
    }
    else if (lightID >= start && lightID <= end) return true;
    return false;
}