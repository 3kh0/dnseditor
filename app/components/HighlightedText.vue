<script setup lang="ts">
interface Segment {
  highlighted: boolean;
  text: string;
}

const props = defineProps<{
  query?: string;
  text: string;
}>();

const segments = computed<Segment[]>(() => {
  const query = props.query?.trim();
  if (!query) return [{ highlighted: false, text: props.text }];

  const output: Segment[] = [];
  const haystack = props.text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  let cursor = 0;
  let match = haystack.indexOf(needle);

  while (match !== -1) {
    if (match > cursor) {
      output.push({ highlighted: false, text: props.text.slice(cursor, match) });
    }

    const end = match + query.length;
    output.push({ highlighted: true, text: props.text.slice(match, end) });
    cursor = end;
    match = haystack.indexOf(needle, cursor);
  }

  if (cursor < props.text.length) {
    output.push({ highlighted: false, text: props.text.slice(cursor) });
  }

  return output.length ? output : [{ highlighted: false, text: props.text }];
});
</script>

<template>
  <template v-for="(segment, index) in segments" :key="index">
    <mark v-if="segment.highlighted" class="bg-primary/20 text-primary">{{ segment.text }}</mark>
    <template v-else>{{ segment.text }}</template>
  </template>
</template>
