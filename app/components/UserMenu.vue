<script setup lang="ts">
const { authenticated, user, pending, login, logout } = useAuth();
</script>

<template>
  <div class="flex items-center gap-2">
    <div v-if="pending && !user" class="size-8 animate-pulse rounded-full bg-darkless" />

    <template v-else-if="authenticated && user">
      <div
        class="flex items-center gap-2 rounded-lg border border-border bg-dark px-2 py-1.5"
        :title="user.login"
      >
        <img
          v-if="user.avatarUrl"
          :src="user.avatarUrl"
          :alt="user.login"
          class="size-6 rounded-full"
          width="24"
          height="24"
        />
        <span class="hidden max-w-28 truncate text-sm text-snow sm:inline">{{ user.login }}</span>
      </div>
      <button
        type="button"
        class="cursor-pointer rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-muted hover:text-snow"
        @click="logout()"
      >
        Sign out
      </button>
    </template>

    <button
      v-else
      type="button"
      class="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-dark px-3 py-2 text-sm text-snow transition-colors hover:bg-darkless"
      @click="login()"
    >
      <Icon name="simple-icons:github" size="1rem" />
      <span class="hidden sm:inline">Sign in with GitHub</span>
      <span class="sm:hidden">Sign in</span>
    </button>
  </div>
</template>
