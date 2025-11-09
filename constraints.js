// ============================================================================
// CONSTRAINT-BASED LAYOUT SYSTEM
// Based on research into Auto Layout, CSS Grid, and Constraint Solvers
// ============================================================================
// ============================================================================
// CONSTRAINT DETECTION
// ============================================================================
export function detectConstraints(objects) {
    const constraints = [];
    // Detect alignments
    constraints.push(...detectAlignments(objects));
    // Detect spacing patterns
    constraints.push(...detectSpacing(objects));
    // Detect distributions
    constraints.push(...detectDistributions(objects));
    // Detect grids
    constraints.push(...detectGrids(objects));
    return constraints;
}
function detectAlignments(objects) {
    const constraints = [];
    const TOLERANCE = 3; // 3px tolerance for alignment detection
    // Group by left alignment
    const leftGroups = groupByCoordinate(objects, obj => obj.x, TOLERANCE);
    for (const group of leftGroups) {
        if (group.length >= 2) {
            constraints.push({
                type: 'alignment',
                alignmentType: 'left',
                objects: group.map(obj => obj.id),
                tolerance: 2,
                coordinate: group[0].x
            });
        }
    }
    // Group by right alignment
    const rightGroups = groupByCoordinate(objects, obj => obj.x + obj.width, TOLERANCE);
    for (const group of rightGroups) {
        if (group.length >= 2) {
            constraints.push({
                type: 'alignment',
                alignmentType: 'right',
                objects: group.map(obj => obj.id),
                tolerance: 2,
                coordinate: group[0].x + group[0].width
            });
        }
    }
    // Group by center-x alignment
    const centerXGroups = groupByCoordinate(objects, obj => obj.x + obj.width / 2, TOLERANCE);
    for (const group of centerXGroups) {
        if (group.length >= 2) {
            constraints.push({
                type: 'alignment',
                alignmentType: 'center-x',
                objects: group.map(obj => obj.id),
                tolerance: 2,
                coordinate: group[0].x + group[0].width / 2
            });
        }
    }
    // Group by top alignment
    const topGroups = groupByCoordinate(objects, obj => obj.y, TOLERANCE);
    for (const group of topGroups) {
        if (group.length >= 2) {
            constraints.push({
                type: 'alignment',
                alignmentType: 'top',
                objects: group.map(obj => obj.id),
                tolerance: 2,
                coordinate: group[0].y
            });
        }
    }
    // Group by bottom alignment
    const bottomGroups = groupByCoordinate(objects, obj => obj.y + obj.height, TOLERANCE);
    for (const group of bottomGroups) {
        if (group.length >= 2) {
            constraints.push({
                type: 'alignment',
                alignmentType: 'bottom',
                objects: group.map(obj => obj.id),
                tolerance: 2,
                coordinate: group[0].y + group[0].height
            });
        }
    }
    // Group by center-y alignment
    const centerYGroups = groupByCoordinate(objects, obj => obj.y + obj.height / 2, TOLERANCE);
    for (const group of centerYGroups) {
        if (group.length >= 2) {
            constraints.push({
                type: 'alignment',
                alignmentType: 'center-y',
                objects: group.map(obj => obj.id),
                tolerance: 2,
                coordinate: group[0].y + group[0].height / 2
            });
        }
    }
    return constraints;
}
function detectSpacing(objects) {
    const constraints = [];
    const TOLERANCE = 3;
    // Sort objects by position
    const sortedByX = [...objects].sort((a, b) => a.x - b.x);
    const sortedByY = [...objects].sort((a, b) => a.y - b.y);
    // Detect horizontal spacing
    for (let i = 0; i < sortedByX.length - 1; i++) {
        const obj1 = sortedByX[i];
        const obj2 = sortedByX[i + 1];
        // Check if they're in the same row (overlapping Y range)
        const yOverlap = Math.min(obj1.y + obj1.height, obj2.y + obj2.height) -
            Math.max(obj1.y, obj2.y);
        if (yOverlap > 0) {
            const spacing = obj2.x - (obj1.x + obj1.width);
            if (spacing > 0 && spacing < 200) { // Reasonable spacing
                constraints.push({
                    type: 'spacing',
                    spacingType: 'horizontal',
                    object1: obj1.id,
                    object2: obj2.id,
                    distance: spacing,
                    tolerance: TOLERANCE
                });
            }
        }
    }
    // Detect vertical spacing
    for (let i = 0; i < sortedByY.length - 1; i++) {
        const obj1 = sortedByY[i];
        const obj2 = sortedByY[i + 1];
        // Check if they're in the same column (overlapping X range)
        const xOverlap = Math.min(obj1.x + obj1.width, obj2.x + obj2.width) -
            Math.max(obj1.x, obj2.x);
        if (xOverlap > 0) {
            const spacing = obj2.y - (obj1.y + obj1.height);
            if (spacing > 0 && spacing < 200) { // Reasonable spacing
                constraints.push({
                    type: 'spacing',
                    spacingType: 'vertical',
                    object1: obj1.id,
                    object2: obj2.id,
                    distance: spacing,
                    tolerance: TOLERANCE
                });
            }
        }
    }
    return constraints;
}
function detectDistributions(objects) {
    const constraints = [];
    const TOLERANCE = 5;
    // Find horizontally distributed objects
    const rows = groupObjectsIntoRows(objects, TOLERANCE);
    for (const row of rows) {
        if (row.length >= 3) {
            const spacings = [];
            for (let i = 0; i < row.length - 1; i++) {
                const spacing = row[i + 1].x - (row[i].x + row[i].width);
                spacings.push(spacing);
            }
            // Check if spacings are consistent
            const avgSpacing = spacings.reduce((a, b) => a + b, 0) / spacings.length;
            const isConsistent = spacings.every(s => Math.abs(s - avgSpacing) <= TOLERANCE);
            if (isConsistent && avgSpacing > 0) {
                constraints.push({
                    type: 'distribution',
                    distributionType: 'horizontal',
                    objects: row.map(obj => obj.id),
                    spacing: avgSpacing,
                    tolerance: TOLERANCE
                });
            }
        }
    }
    // Find vertically distributed objects
    const columns = groupObjectsIntoColumns(objects, TOLERANCE);
    for (const column of columns) {
        if (column.length >= 3) {
            const spacings = [];
            for (let i = 0; i < column.length - 1; i++) {
                const spacing = column[i + 1].y - (column[i].y + column[i].height);
                spacings.push(spacing);
            }
            // Check if spacings are consistent
            const avgSpacing = spacings.reduce((a, b) => a + b, 0) / spacings.length;
            const isConsistent = spacings.every(s => Math.abs(s - avgSpacing) <= TOLERANCE);
            if (isConsistent && avgSpacing > 0) {
                constraints.push({
                    type: 'distribution',
                    distributionType: 'vertical',
                    objects: column.map(obj => obj.id),
                    spacing: avgSpacing,
                    tolerance: TOLERANCE
                });
            }
        }
    }
    return constraints;
}
function detectGrids(objects) {
    const constraints = [];
    const TOLERANCE = 5;
    // Group into rows
    const rows = groupObjectsIntoRows(objects, TOLERANCE);
    // Check if rows have consistent column counts and alignment
    if (rows.length >= 2) {
        const columnCounts = rows.map(row => row.length);
        const consistentColumns = columnCounts.every(c => c === columnCounts[0]);
        if (consistentColumns && columnCounts[0] >= 2) {
            // Check if columns align vertically
            const firstRow = rows[0];
            let isGrid = true;
            for (let col = 0; col < firstRow.length; col++) {
                const colObjects = rows.map(row => row[col]);
                const xPositions = colObjects.map(obj => obj.x);
                const avgX = xPositions.reduce((a, b) => a + b, 0) / xPositions.length;
                if (!xPositions.every(x => Math.abs(x - avgX) <= TOLERANCE)) {
                    isGrid = false;
                    break;
                }
            }
            if (isGrid) {
                // Calculate row and column gaps
                const rowGaps = [];
                for (let i = 0; i < rows.length - 1; i++) {
                    const gap = rows[i + 1][0].y - (rows[i][0].y + rows[i][0].height);
                    rowGaps.push(gap);
                }
                const colGaps = [];
                for (let i = 0; i < firstRow.length - 1; i++) {
                    const gap = firstRow[i + 1].x - (firstRow[i].x + firstRow[i].width);
                    colGaps.push(gap);
                }
                const avgRowGap = rowGaps.length > 0 ?
                    rowGaps.reduce((a, b) => a + b, 0) / rowGaps.length : 0;
                const avgColGap = colGaps.length > 0 ?
                    colGaps.reduce((a, b) => a + b, 0) / colGaps.length : 0;
                const gridObjects = rows.map(row => row.map(obj => obj.id));
                constraints.push({
                    type: 'grid',
                    rows: rows.length,
                    columns: firstRow.length,
                    objects: gridObjects,
                    rowGap: avgRowGap,
                    columnGap: avgColGap,
                    tolerance: TOLERANCE
                });
            }
        }
    }
    return constraints;
}
// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function groupByCoordinate(objects, getCoord, tolerance) {
    const groups = [];
    for (const obj of objects) {
        const coord = getCoord(obj);
        let foundGroup = false;
        for (const group of groups) {
            const groupCoord = getCoord(group[0]);
            if (Math.abs(coord - groupCoord) <= tolerance) {
                group.push(obj);
                foundGroup = true;
                break;
            }
        }
        if (!foundGroup) {
            groups.push([obj]);
        }
    }
    return groups;
}
function groupObjectsIntoRows(objects, tolerance) {
    const sortedByY = [...objects].sort((a, b) => a.y - b.y);
    const rows = [];
    for (const obj of sortedByY) {
        let foundRow = false;
        for (const row of rows) {
            const rowY = row[0].y + row[0].height / 2;
            const objY = obj.y + obj.height / 2;
            if (Math.abs(rowY - objY) <= tolerance) {
                row.push(obj);
                foundRow = true;
                break;
            }
        }
        if (!foundRow) {
            rows.push([obj]);
        }
    }
    // Sort objects within each row by x position
    for (const row of rows) {
        row.sort((a, b) => a.x - b.x);
    }
    return rows;
}
function groupObjectsIntoColumns(objects, tolerance) {
    const sortedByX = [...objects].sort((a, b) => a.x - b.x);
    const columns = [];
    for (const obj of sortedByX) {
        let foundColumn = false;
        for (const column of columns) {
            const colX = column[0].x + column[0].width / 2;
            const objX = obj.x + obj.width / 2;
            if (Math.abs(colX - objX) <= tolerance) {
                column.push(obj);
                foundColumn = true;
                break;
            }
        }
        if (!foundColumn) {
            columns.push([obj]);
        }
    }
    // Sort objects within each column by y position
    for (const column of columns) {
        column.sort((a, b) => a.y - b.y);
    }
    return columns;
}
// ============================================================================
// CONSTRAINT VALIDATION
// ============================================================================
export function isConstraintSatisfied(constraint, objects) {
    switch (constraint.type) {
        case 'alignment':
            return isAlignmentSatisfied(constraint, objects);
        case 'spacing':
            return isSpacingSatisfied(constraint, objects);
        case 'distribution':
            return isDistributionSatisfied(constraint, objects);
        case 'grid':
            return isGridSatisfied(constraint, objects);
        default:
            return true;
    }
}
function isAlignmentSatisfied(constraint, objects) {
    const constraintObjects = constraint.objects
        .map(id => objects.get(id))
        .filter((obj) => obj !== undefined);
    if (constraintObjects.length < 2)
        return true;
    const getAlignCoord = (obj) => {
        switch (constraint.alignmentType) {
            case 'left': return obj.x;
            case 'right': return obj.x + obj.width;
            case 'center-x': return obj.x + obj.width / 2;
            case 'top': return obj.y;
            case 'bottom': return obj.y + obj.height;
            case 'center-y': return obj.y + obj.height / 2;
            default: return 0;
        }
    };
    const coords = constraintObjects.map(getAlignCoord);
    const avgCoord = coords.reduce((a, b) => a + b, 0) / coords.length;
    return coords.every(coord => Math.abs(coord - avgCoord) <= constraint.tolerance);
}
function isSpacingSatisfied(constraint, objects) {
    const obj1 = objects.get(constraint.object1);
    const obj2 = objects.get(constraint.object2);
    if (!obj1 || !obj2)
        return true;
    const actualSpacing = constraint.spacingType === 'horizontal'
        ? obj2.x - (obj1.x + obj1.width)
        : obj2.y - (obj1.y + obj1.height);
    return Math.abs(actualSpacing - constraint.distance) <= constraint.tolerance;
}
function isDistributionSatisfied(constraint, objects) {
    const constraintObjects = constraint.objects
        .map(id => objects.get(id))
        .filter((obj) => obj !== undefined);
    if (constraintObjects.length < 3)
        return true;
    const spacings = [];
    for (let i = 0; i < constraintObjects.length - 1; i++) {
        const obj1 = constraintObjects[i];
        const obj2 = constraintObjects[i + 1];
        const spacing = constraint.distributionType === 'horizontal'
            ? obj2.x - (obj1.x + obj1.width)
            : obj2.y - (obj1.y + obj1.height);
        spacings.push(spacing);
    }
    return spacings.every(s => Math.abs(s - constraint.spacing) <= constraint.tolerance);
}
function isGridSatisfied(constraint, objects) {
    // Simplified grid validation
    for (let row = 0; row < constraint.objects.length; row++) {
        for (let col = 0; col < constraint.objects[row].length; col++) {
            const objId = constraint.objects[row][col];
            const obj = objects.get(objId);
            if (!obj)
                return false;
        }
    }
    return true;
}
export function computeConstraintDiff(beforeConstraints, afterObjects, movedObjectId) {
    const objectsMap = new Map(afterObjects.map(obj => [obj.id, obj]));
    const preserved = [];
    const violated = [];
    for (const constraint of beforeConstraints) {
        const involves = constraintInvolvesObject(constraint, movedObjectId);
        if (!involves) {
            preserved.push(constraint);
        }
        else {
            const satisfied = isConstraintSatisfied(constraint, objectsMap);
            if (satisfied) {
                preserved.push(constraint);
            }
            else {
                violated.push(constraint);
            }
        }
    }
    // Detect new constraints in the current state
    const newConstraints = detectConstraints(afterObjects);
    // Find all objects affected by violated constraints
    const affectedObjects = new Set([movedObjectId]);
    for (const constraint of violated) {
        getConstraintObjects(constraint).forEach(id => affectedObjects.add(id));
    }
    return {
        preserved,
        violated,
        newConstraints,
        affectedObjects,
        movedObject: movedObjectId
    };
}
function constraintInvolvesObject(constraint, objectId) {
    return getConstraintObjects(constraint).indexOf(objectId) !== -1;
}
function getConstraintObjects(constraint) {
    switch (constraint.type) {
        case 'alignment':
            return constraint.objects;
        case 'spacing':
            return [constraint.object1, constraint.object2];
        case 'distribution':
            return constraint.objects;
        case 'grid':
            return constraint.objects.reduce((acc, row) => acc.concat(row), []);
        case 'containment':
            return [constraint.container].concat(constraint.contained);
        default:
            return [];
    }
}
