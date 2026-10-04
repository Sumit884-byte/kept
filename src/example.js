import { interpret } from './analyze.js'
import { applyHistory } from './history.js'
import { composeResume } from './resume.js'
import { samplePerson, sampleProjects } from './sample.js'

export function exampleResume() {
  const projects = sampleProjects.map((sample) => applyHistory(interpret(sample.gather).project, sample.earlier))
  return composeResume({
    person: { ...samplePerson, example: true },
    projects,
    prefs: {
      roleTarget: 'Product engineer',
      headline: 'Product engineer',
      instructions: '',
    },
  })
}
