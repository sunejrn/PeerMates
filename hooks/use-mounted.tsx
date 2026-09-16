'use client'

import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

export default function useMounted() {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
}