<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * SEEDED ON PURPOSE: this test always fails. Do not fix or delete it.
 *
 * MIRAI's test baseline (unit 17) must record it as an existing failure, so it never
 * blocks new work. See the README, "Seeded test traps".
 */
class KnownFailureSeedTest extends TestCase
{
    public function test_known_failure_seed(): void
    {
        $this->assertSame('expected', 'actual', 'Seeded known failure (see README).');
    }
}
