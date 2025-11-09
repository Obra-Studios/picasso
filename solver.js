// ============================================================================
// CONSTRAINT SOLVER - Deterministic solution for simple cases
// Based on Cassowary algorithm principles (used in iOS Auto Layout)
// ============================================================================
// ============================================================================
// QUICK SOLVE - Deterministic solver for simple patterns
// ============================================================================
export function quickSolve(constraints, objects, fixedObjectIds) {
    const objectsMap = new Map(objects.map(obj => [obj.id, obj]));
    const fixedSet = new Set(fixedObjectIds);
    // Try alignment-only solution
    if (isAlignmentOnly(constraints)) {
        return solveAlignments(constraints, objectsMap, fixedSet);
    }
    // Try simple spacing solution
    if (isSimpleSpacing(constraints)) {
        return solveSpacing(constraints, objectsMap, fixedSet);
    }
    // Try distribution solution
    if (isSimpleDistribution(constraints)) {
        return solveDistribution(constraints, objectsMap, fixedSet);
    }
    return null; // Fall back to LLM for complex cases
}
// ============================================================================
// PATTERN DETECTION
// ============================================================================
function isAlignmentOnly(constraints) {
    return constraints.length > 0 && constraints.every(c => c.type === 'alignment');
}
function isSimpleSpacing(constraints) {
    return constraints.length > 0 && constraints.every(c => c.type === 'spacing');
}
function isSimpleDistribution(constraints) {
    return constraints.length > 0 && constraints.every(c => c.type === 'distribution');
}
// ============================================================================
// ALIGNMENT SOLVER
// ============================================================================
function solveAlignments(constraints, objectsMap, fixedObjects) {
    const adjustments = [];
    const satisfied = [];
    const unsatisfied = [];
    // Create a working copy of objects
    const workingObjects = new Map(objectsMap);
    for (const constraint of constraints) {
        const objects = constraint.objects
            .map(id => workingObjects.get(id))
            .filter((obj) => obj !== undefined);
        if (objects.length < 2) {
            satisfied.push(constraint);
            continue;
        }
        // Find the reference coordinate (from fixed objects or average)
        const fixedObjs = objects.filter(obj => fixedObjects.has(obj.id));
        const movableObjs = objects.filter(obj => !fixedObjects.has(obj.id));
        if (movableObjs.length === 0) {
            satisfied.push(constraint);
            continue;
        }
        const targetCoord = fixedObjs.length > 0
            ? getAlignmentCoord(fixedObjs[0], constraint.alignmentType)
            : getAverageAlignmentCoord(objects, constraint.alignmentType);
        // Adjust movable objects to align
        for (const obj of movableObjs) {
            const currentCoord = getAlignmentCoord(obj, constraint.alignmentType);
            const delta = targetCoord - currentCoord;
            if (Math.abs(delta) > constraint.tolerance) {
                const newObj = applyAlignmentDelta(obj, constraint.alignmentType, delta);
                workingObjects.set(obj.id, newObj);
                adjustments.push({
                    objectId: obj.id,
                    newX: newObj.x,
                    newY: newObj.y,
                    reasoning: `Align ${constraint.alignmentType} to ${Math.round(targetCoord)}px`
                });
            }
        }
        satisfied.push(constraint);
    }
    const score = calculateScore(satisfied.length, unsatisfied.length, constraints.length);
    return {
        adjustments,
        score,
        satisfied,
        unsatisfied
    };
}
function getAlignmentCoord(obj, alignmentType) {
    switch (alignmentType) {
        case 'left': return obj.x;
        case 'right': return obj.x + obj.width;
        case 'center-x': return obj.x + obj.width / 2;
        case 'top': return obj.y;
        case 'bottom': return obj.y + obj.height;
        case 'center-y': return obj.y + obj.height / 2;
        default: return 0;
    }
}
function getAverageAlignmentCoord(objects, alignmentType) {
    const coords = objects.map(obj => getAlignmentCoord(obj, alignmentType));
    return coords.reduce((a, b) => a + b, 0) / coords.length;
}
function applyAlignmentDelta(obj, alignmentType, delta) {
    const newObj = Object.assign({}, obj);
    switch (alignmentType) {
        case 'left':
            newObj.x = obj.x + delta;
            break;
        case 'right':
            newObj.x = obj.x + delta;
            break;
        case 'center-x':
            newObj.x = obj.x + delta;
            break;
        case 'top':
            newObj.y = obj.y + delta;
            break;
        case 'bottom':
            newObj.y = obj.y + delta;
            break;
        case 'center-y':
            newObj.y = obj.y + delta;
            break;
    }
    return newObj;
}
// ============================================================================
// SPACING SOLVER
// ============================================================================
function solveSpacing(constraints, objectsMap, fixedObjects) {
    const adjustments = [];
    const satisfied = [];
    const unsatisfied = [];
    const workingObjects = new Map(objectsMap);
    for (const constraint of constraints) {
        const obj1 = workingObjects.get(constraint.object1);
        const obj2 = workingObjects.get(constraint.object2);
        if (!obj1 || !obj2) {
            satisfied.push(constraint);
            continue;
        }
        // Determine which object should move
        const obj1Fixed = fixedObjects.has(obj1.id);
        const obj2Fixed = fixedObjects.has(obj2.id);
        if (obj1Fixed && obj2Fixed) {
            // Both fixed, can't solve
            unsatisfied.push(constraint);
            continue;
        }
        const actualSpacing = constraint.spacingType === 'horizontal'
            ? obj2.x - (obj1.x + obj1.width)
            : obj2.y - (obj1.y + obj1.height);
        const delta = constraint.distance - actualSpacing;
        if (Math.abs(delta) <= constraint.tolerance) {
            satisfied.push(constraint);
            continue;
        }
        // Move the non-fixed object
        if (!obj2Fixed) {
            const newObj2 = Object.assign({}, obj2);
            if (constraint.spacingType === 'horizontal') {
                newObj2.x = obj2.x + delta;
            }
            else {
                newObj2.y = obj2.y + delta;
            }
            workingObjects.set(obj2.id, newObj2);
            adjustments.push({
                objectId: obj2.id,
                newX: newObj2.x,
                newY: newObj2.y,
                reasoning: `Maintain ${constraint.distance}px ${constraint.spacingType} spacing from ${obj1.name}`
            });
            satisfied.push(constraint);
        }
        else if (!obj1Fixed) {
            const newObj1 = Object.assign({}, obj1);
            if (constraint.spacingType === 'horizontal') {
                newObj1.x = obj1.x - delta;
            }
            else {
                newObj1.y = obj1.y - delta;
            }
            workingObjects.set(obj1.id, newObj1);
            adjustments.push({
                objectId: obj1.id,
                newX: newObj1.x,
                newY: newObj1.y,
                reasoning: `Maintain ${constraint.distance}px ${constraint.spacingType} spacing to ${obj2.name}`
            });
            satisfied.push(constraint);
        }
    }
    const score = calculateScore(satisfied.length, unsatisfied.length, constraints.length);
    return {
        adjustments,
        score,
        satisfied,
        unsatisfied
    };
}
// ============================================================================
// DISTRIBUTION SOLVER
// ============================================================================
function solveDistribution(constraints, objectsMap, fixedObjects) {
    const adjustments = [];
    const satisfied = [];
    const unsatisfied = [];
    const workingObjects = new Map(objectsMap);
    for (const constraint of constraints) {
        const objects = constraint.objects
            .map(id => workingObjects.get(id))
            .filter((obj) => obj !== undefined);
        if (objects.length < 3) {
            satisfied.push(constraint);
            continue;
        }
        // Sort objects by position
        const sorted = constraint.distributionType === 'horizontal'
            ? [...objects].sort((a, b) => a.x - b.x)
            : [...objects].sort((a, b) => a.y - b.y);
        // Find fixed anchors
        const fixedIndices = sorted
            .map((obj, idx) => fixedObjects.has(obj.id) ? idx : -1)
            .filter(idx => idx !== -1);
        if (fixedIndices.length === 0) {
            // No anchors, distribute from first object
            let currentPos = constraint.distributionType === 'horizontal'
                ? sorted[0].x + sorted[0].width
                : sorted[0].y + sorted[0].height;
            for (let i = 1; i < sorted.length; i++) {
                const obj = sorted[i];
                const newPos = currentPos + constraint.spacing;
                const newObj = Object.assign({}, obj);
                if (constraint.distributionType === 'horizontal') {
                    newObj.x = newPos;
                    currentPos = newPos + obj.width;
                }
                else {
                    newObj.y = newPos;
                    currentPos = newPos + obj.height;
                }
                workingObjects.set(obj.id, newObj);
                adjustments.push({
                    objectId: obj.id,
                    newX: newObj.x,
                    newY: newObj.y,
                    reasoning: `Distribute evenly with ${constraint.spacing}px spacing`
                });
            }
            satisfied.push(constraint);
        }
        else {
            // Has anchors, distribute between them
            unsatisfied.push(constraint);
        }
    }
    const score = calculateScore(satisfied.length, unsatisfied.length, constraints.length);
    return {
        adjustments,
        score,
        satisfied,
        unsatisfied
    };
}
// ============================================================================
// SCORING
// ============================================================================
function calculateScore(satisfied, unsatisfied, total) {
    if (total === 0)
        return 100;
    return Math.round((satisfied / total) * 100);
}
