import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Random } from 'meteor/random';

import _ from 'lodash';
import SimpleSchema from 'simpl-schema';

const { Integer } = SimpleSchema;

export const EstimateType = {
    backlog: "backlog",
    workPattern: "workPattern"
};

export const StartType = {
    fixedDate: "fixedDate",
    after: "after",
    with: "with"
};

export const ThroughputType = {
    samples: "throughputSamples",
    estimate: "throughputEstimate",
    none: "none"
};

export const Backlog = new SimpleSchema({

    // backlog size
    lowGuess: { type: Integer, min: 0 },
    highGuess: { type: Integer, min: 0 },
    lowSplitRate: { type: Number, min: 1 },
    highSplitRate: { type: Number, min: 1 },

    // possible risks that could increase scope
    risks: { type: Array, optional: true },
    
    'risks.$': Object,
    'risks.$.name': String,
    'risks.$.description': { type: String, optional: true },
    'risks.$.likelihood': { type: Number, min: 0, max: 1}, // percentage
    'risks.$.lowImpact': { type: Integer, min: 0 },  // number of work items added if risk hits (low guess)
    'risks.$.highImpact': { type: Integer, min: 0 }, // number of work items added if risk hits (high guess)

});

export const Team = new SimpleSchema({

    members: { type: Array, optional: true },
    'members.$': Object,
    'members.$.role': String,
    'members.$.description': { type: String, optional: true },
    'members.$.quantity': { type: Number, min: 0 },

    // throughput calculations
    throughputPeriodLength: { type: Number, min: 1 }, // weeks 
    throughputType: { type: String, optional: true, allowedValues: Object.values(ThroughputType) }, // are we using samples or estimates?

    // team's historical throughput
    throughputSamples: { type: Array, optional: true },
    'throughputSamples.$': Object,
    'throughputSamples.$.periodStartDate': Date, // e.g. start of week or sprint
    'throughputSamples.$.description': { type: String, optional: true },
    'throughputSamples.$.throughput': Integer, // number of work items during this period

    // guess of team's throughput (will be used if there are no historical samples)
    throughputEstimate: { type: Object, optional: true },
    'throughputEstimate.lowGuess': { type: Integer, min: 0 }, // work items per period (low guess)
    'throughputEstimate.highGuess': { type: Integer, min: 0 }, // work items per period (high guess)

    // S-curve scaling
    rampUp: { type: Object, optional: true },
    'rampUp.duration': { type: Number, min: 0 }, // number of periods of ramp up
    'rampUp.throughputScalingLowGuess': { type: Number, min: 0 }, // work items per period (low guess)
    'rampUp.throughputScalingHighGuess': { type: Number, min: 0 }, // work items per period (high guess)

    // team's work pattern (will be used if there are no samples or throughput guesses)
    workPattern: { type: Array, optional: true },
    'workPattern.$': Object,
    'workPattern.$.startDate': Date,
    'workPattern.$.endDate': Date

});


export const Solution = new SimpleSchema({

    _id: String,
    name: String,
    description: { type: String, optional: true },
    notes: { type: String, optional: true },

    estimateType: { type: String, allowedValues: Object.values(EstimateType) },

    startType: { type: String, allowedValues: Object.values(StartType) },
    startDate: { type: Date, optional: true },  // fixed date of starting
    startDependency: { type: String, optional: true },  // id of other solution in this project

    backlog: { type: Backlog, optional: true },
    team: Team
    
});

export const Project = new SimpleSchema({
    _id: String,

    // security
    owner: String,
    readOnlyShares: [String],
    readWriteShares: [String],

    // basic metadata
    name: String,
    description: { type: String, optional: true },

    // list of solutions
    solutions: [Solution]
});

/**
 * Create a new minimal solution object
 */
export function newSolution({ name, ...rest }) {
    return Solution.clean(_.assignIn({
        _id: Random.id(),
        name,
        description: null,
        notes: null,

        estimateType: EstimateType.backlog,
        
        startType: StartType.fixedDate,
        startDate: null,
        startDependency: null,
        
        backlog: {
            lowGuess: 0,
            highGuess: 0,
            lowSplitRate: 1,
            highSplitRate: 1   
        },

        risks: [],
        
        team: {
            members: [],
            throughputPeriodLength: 1,
            throughputType: ThroughputType.estimate,
            throughputSamples: [],
            throughputEstimate: {
                lowGuess: 0,
                highGuess: 0
            },
            rampUp: null,
            workPattern: []
        }
    }, rest));
}

const Projects = new Mongo.Collection("Projects");
Projects.attachSchema(Project);

Projects.allow({

    insert(userId, doc) {
        return userId && doc.owner === userId;
    },

    update(userId, doc, fields, modifier) {
        return userId && (userId === doc.owner || _.includes(doc.readWriteShares, userId)) && !_.includes(fields, 'owner');
    },

    remove(userId, doc) {
        return userId && doc.owner === userId;
    },

    fetch: ['owner', 'readWriteShares']

});

export default Projects;

export function checkProjectOwnership(userId, projectId, canWrite) {
    if (!userId) {
        return false;
    }

    const project = Projects.findOne(projectId);
    if (!project) {
        return false;
    }

    return (
        project.owner === userId ||
        (!canWrite && _.includes(project.readOnlyShares, userId)) ||
        _.includes(project.readWriteShares, userId)
    );
}


if (Meteor.isServer) {

    Meteor.publish('projects', function () {
        if (!this.userId) {
            this.error(new Meteor.Error(401, 'Unauthorized'));
        } else {
            return Projects.find({
                $or: [
                    { owner: this.userId },
                    { readOnlyShares: this.userId },
                    { readWriteShares: this.userId }
                ]
            });
        }
    });
    
}
