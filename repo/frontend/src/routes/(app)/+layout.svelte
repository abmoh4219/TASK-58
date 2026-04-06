<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { fade, fly } from 'svelte/transition';
  import { toast } from 'svelte-sonner';

  import { Button } from '$lib/components/ui/button';
  import { prefersReducedMotion } from '$lib/motion';
  import { setTheme, themePreference, type ThemePreference } from '$lib/theme';

  import type { LayoutData } from './$types';

  export let data: LayoutData;

  const themeOptions: ThemePreference[] = ['light', 'dark', 'system'];

  const navigation = [
    { name: 'Overview', href: '/', badge: 'home' },
    { name: 'Member Workspace', href: '/member', badge: 'member' },
    { name: 'Front Desk', href: '/front-desk', badge: 'desk' },
    { name: 'Instructor Workspace', href: '/instructor', badge: 'coach' },
    { name: 'Admin Workspace', href: '/admin', badge: 'admin' },
    { name: 'Dashboard', href: '/dashboard', badge: 'ops' }
  ];

  let mobileNavOpen = false;
  let signingOut = false;

  $: breadcrumbParts = $page.url.pathname.split('/').filter(Boolean);

  $: breadcrumbLabel =
    breadcrumbParts.length === 0
      ? 'Overview'
      : breadcrumbParts.map((part) => part.replace(/-/g, ' ')).join(' / ');

  function isActive(path: string, href: string): boolean {
    if (href === '/') {
      return path === '/';
    }

    return path === href || path.startsWith(`${href}/`);
  }

  function resolveBrowserApiBaseUrl(): string {
    const configured = data.publicApiBaseUrl;

    if (typeof window === 'undefined') {
      return configured;
    }

    try {
      const url = new URL(configured);
      if (url.hostname === 'backend' || url.hostname === 'localhost') {
        url.hostname = window.location.hostname;
        url.port = window.location.port || url.port;
      }
      return url.toString().replace(/\/$/, '');
    } catch {
      return `${window.location.origin}/api/v1`;
    }
  }

  async function signOut(): Promise<void> {
    if (signingOut) {
      return;
    }

    signingOut = true;
    const apiBaseUrl = resolveBrowserApiBaseUrl();

    try {
      const response = await fetch(`${apiBaseUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message || 'Unable to sign out.');
      }

      toast.success('Signed out');
      await goto('/sign-in');
    } catch (error) {
      toast.error('Sign out failed', {
        description: error instanceof Error ? error.message : 'Unable to sign out right now.'
      });
    } finally {
      signingOut = false;
    }
  }
</script>

<div class="app-canvas min-h-screen bg-background text-foreground">
  <div class="flex min-h-screen">
    <aside
      class="hidden w-[18rem] shrink-0 border-r border-border/70 bg-card/72 px-s4 py-s6 backdrop-blur lg:block"
      aria-label="Primary navigation"
    >
      <div class="flex items-center gap-s3 px-s2">
        <div class="grid h-10 w-10 place-items-center rounded-lg border border-primary/25 bg-primary/15 text-sm font-semibold text-primary shadow-glow">
          CS
        </div>
        <div>
          <p class="text-sm font-medium text-foreground">Culinary Studio</p>
          <p class="text-xs text-muted-foreground">Operations Platform</p>
        </div>
      </div>

      <nav class="mt-s8 space-y-s2">
        {#each navigation as item}
          <a
            href={item.href}
            class="group flex items-center justify-between rounded-md px-s3 py-s2 text-sm surface-transition hover:bg-muted/70 {isActive($page.url.pathname, item.href)
              ? 'bg-primary/14 text-foreground shadow-xs'
              : 'text-muted-foreground'}"
          >
            <span>{item.name}</span>
            <span class="rounded-full border px-s2 py-[2px] text-[10px] uppercase tracking-wide">{item.badge}</span>
          </a>
        {/each}
      </nav>
    </aside>

    <div class="flex min-h-screen min-w-0 flex-1 flex-col">
      <header class="sticky top-0 z-30 border-b border-border/60 bg-background/72 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div class="mx-auto flex min-h-16 w-full max-w-[90rem] flex-wrap items-center justify-between gap-3 px-s4 py-2 md:px-s6">
          <div class="flex items-center gap-s3">
            <button
              type="button"
              class="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border/80 bg-card/70 text-muted-foreground surface-transition hover:text-foreground lg:hidden"
              on:click={() => (mobileNavOpen = true)}
              aria-label="Open navigation"
            >
              ☰
            </button>
            <div>
              <p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Workspace</p>
              <h1 class="text-sm font-semibold capitalize md:text-base">{breadcrumbLabel}</h1>
            </div>
          </div>

          <div class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
            <div class="flex flex-wrap items-center gap-1 rounded-md border border-border/80 bg-card/80 p-1">
              {#each themeOptions as option}
                <Button
                  size="sm"
                  variant={$themePreference === option ? 'default' : 'ghost'}
                  className="capitalize"
                  on:click={() => setTheme(option)}
                >
                  {option}
                </Button>
              {/each}
            </div>

            <div class="flex items-center gap-2 rounded-md border border-border/80 bg-card/80 px-2 py-1">
              <span class="hidden max-w-[10rem] truncate text-xs text-muted-foreground sm:inline">{data.session.user.username}</span>
              <Button size="sm" variant="secondary" on:click={signOut} disabled={signingOut}>
                {signingOut ? 'Signing out...' : 'Sign out'}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main class="mx-auto w-full max-w-[90rem] flex-1 px-s4 py-s6 md:px-s6 md:py-s8">
        <slot />
      </main>
    </div>
  </div>

  {#if mobileNavOpen}
    <div
      class="fixed inset-0 z-40 bg-black/45 lg:hidden"
      role="presentation"
      on:click={() => (mobileNavOpen = false)}
      transition:fade={{ duration: $prefersReducedMotion ? 0 : 120 }}
    ></div>
    <aside
      class="fixed inset-y-0 left-0 z-50 w-[18rem] border-r border-border/80 bg-card/92 px-s4 py-s6 shadow-lg backdrop-blur lg:hidden"
      in:fly={{ x: -24, duration: $prefersReducedMotion ? 0 : 160 }}
      out:fly={{ x: -18, duration: $prefersReducedMotion ? 0 : 120 }}
    >
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold">Navigation</p>
        <button
          type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-md border"
          on:click={() => (mobileNavOpen = false)}
          aria-label="Close navigation"
        >
          ×
        </button>
      </div>

      <nav class="mt-s6 space-y-s2">
        {#each navigation as item}
          <a
            href={item.href}
            class="flex items-center justify-between rounded-md px-s3 py-s2 text-sm surface-transition hover:bg-muted hover:text-foreground {isActive($page.url.pathname, item.href)
              ? 'bg-primary/14 text-foreground'
              : 'text-muted-foreground'}"
            on:click={() => (mobileNavOpen = false)}
          >
            <span>{item.name}</span>
            <span class="rounded-full border px-s2 py-[2px] text-[10px] uppercase tracking-wide">{item.badge}</span>
          </a>
        {/each}
      </nav>

      <div class="mt-s6 rounded-md border bg-background/70 p-s3">
        <p class="truncate text-xs text-muted-foreground">{data.session.user.username}</p>
        <Button className="mt-2 w-full" size="sm" variant="secondary" on:click={signOut} disabled={signingOut}>
          {signingOut ? 'Signing out...' : 'Sign out'}
        </Button>
      </div>
    </aside>
  {/if}
</div>
