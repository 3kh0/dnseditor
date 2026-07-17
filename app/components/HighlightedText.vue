<script setup lang="ts">
interface Seg {
  h: boolean;
  t: string;
}

const props = defineProps<{ query?: string; text: string }>();

const segments = computed<Seg[]>(() => {
  const q = props.query?.trim();
  if (!q) return [{ h: false, t: props.text }];

  const out: Seg[] = [];
  const hay = props.text.toLocaleLowerCase();
  const needle = q.toLocaleLowerCase();
  let cur = 0;
  let m = hay.indexOf(needle);

  while (m !== -1) {
    if (m > cur) out.push({ h: false, t: props.text.slice(cur, m) });
    const end = m + q.length;
    out.push({ h: true, t: props.text.slice(m, end) });
    cur = end;
    m = hay.indexOf(needle, cur);
  }

  if (cur < props.text.length) out.push({ h: false, t: props.text.slice(cur) });
  return out.length ? out : [{ h: false, t: props.text }];
});
</script>

<template>
  <template v-for="(s, i) in segments" :key="i">
    <mark v-if="s.h" class="bg-primary/20 text-primary">{{ s.t }}</mark>
    <template v-else>{{ s.t }}</template>
  </template>
</template>
