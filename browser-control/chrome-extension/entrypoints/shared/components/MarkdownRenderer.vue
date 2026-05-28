<script setup lang="ts">
import 'markstream-vue/index.css'
import MarkdownRender from 'markstream-vue'

const props = withDefaults(
  defineProps<{
    /** Markdown string to render. Appended chunks are diffed for streaming. */
    content: string
    /** Set true when the stream is complete so the renderer finalises output. */
    final?: boolean
  }>(),
  { final: false },
)
</script>

<template>
  <MarkdownRender
    :content="props.content"
    :final="props.final"
    :smooth-streaming="true"
  />
</template>
