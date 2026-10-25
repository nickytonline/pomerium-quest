import { createFileRoute } from '@tanstack/react-router'
import { Quest } from '../components/Quest.tsx'

export const Route = createFileRoute('/')({
  component: Quest,
})
