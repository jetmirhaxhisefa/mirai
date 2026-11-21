<?php

namespace Tests\Feature;

use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TaskApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_user_sees_only_their_own_tasks(): void
    {
        $user = User::factory()->create();
        Task::factory()->for($user)->create(['title' => 'Mine']);
        Task::factory()->create(['title' => 'Someone else']);

        $this->actingAs($user)->getJson('/api/tasks')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.title', 'Mine');
    }

    public function test_a_user_can_create_a_task(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/api/tasks', ['title' => 'Write the README'])
            ->assertCreated()
            ->assertJsonPath('title', 'Write the README')
            ->assertJsonPath('done', false);

        $this->assertDatabaseHas('tasks', ['user_id' => $user->id, 'title' => 'Write the README']);
    }

    public function test_an_invalid_task_is_refused(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/api/tasks', ['title' => ''])
            ->assertStatus(422)
            ->assertJsonValidationErrors('title');
    }

    public function test_a_too_long_title_is_refused(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/api/tasks', ['title' => str_repeat('a', Task::MAX_TITLE_LENGTH + 1)])
            ->assertStatus(422)
            ->assertJsonValidationErrors('title');
    }

    public function test_done_cannot_be_set_on_create(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/api/tasks', ['title' => 'Sneaky', 'done' => true])
            ->assertCreated()
            ->assertJsonPath('done', false);
    }

    public function test_a_user_can_complete_their_task(): void
    {
        $user = User::factory()->create();
        $task = Task::factory()->for($user)->create();

        $this->actingAs($user)->patchJson("/api/tasks/{$task->id}")
            ->assertOk()
            ->assertJsonPath('done', true);
    }

    public function test_a_user_cannot_complete_another_users_task(): void
    {
        $task = Task::factory()->create();

        $this->actingAs(User::factory()->create())->patchJson("/api/tasks/{$task->id}")
            ->assertForbidden();

        $this->assertFalse($task->fresh()->done);
    }

    public function test_a_user_can_rename_their_task(): void
    {
        $user = User::factory()->create();
        $task = Task::factory()->for($user)->create(['title' => 'Buy milk']);

        $this->actingAs($user)->putJson("/api/tasks/{$task->id}", ['title' => 'Buy oat milk'])
            ->assertOk()
            ->assertJsonPath('title', 'Buy oat milk');

        $this->actingAs($user)->getJson('/api/tasks')
            ->assertJsonPath('0.title', 'Buy oat milk');
    }

    public function test_renaming_changes_only_the_title(): void
    {
        $user = User::factory()->create();
        $other = User::factory()->create();
        $task = Task::factory()->for($user)->create(['title' => 'Buy milk']);

        $this->actingAs($user)->putJson("/api/tasks/{$task->id}", [
            'title' => 'Buy oat milk',
            'done' => true,
            'user_id' => $other->id,
        ])->assertOk();

        $fresh = $task->fresh();
        $this->assertSame('Buy oat milk', $fresh->title);
        $this->assertFalse($fresh->done);
        $this->assertSame($user->id, $fresh->user_id);
    }

    public function test_renaming_to_an_empty_title_is_refused(): void
    {
        $user = User::factory()->create();
        $task = Task::factory()->for($user)->create(['title' => 'Buy milk']);

        $this->actingAs($user)->putJson("/api/tasks/{$task->id}", ['title' => ''])
            ->assertStatus(422)
            ->assertJsonValidationErrors('title');

        $this->assertSame('Buy milk', $task->fresh()->title);
    }

    public function test_renaming_to_a_too_long_title_is_refused(): void
    {
        $user = User::factory()->create();
        $task = Task::factory()->for($user)->create(['title' => 'Buy milk']);

        $this->actingAs($user)->putJson("/api/tasks/{$task->id}", ['title' => str_repeat('a', Task::MAX_TITLE_LENGTH + 1)])
            ->assertStatus(422)
            ->assertJsonValidationErrors('title');

        $this->assertSame('Buy milk', $task->fresh()->title);
    }

    public function test_a_user_cannot_rename_another_users_task(): void
    {
        $task = Task::factory()->create(['title' => 'Buy milk']);

        $this->actingAs(User::factory()->create())->putJson("/api/tasks/{$task->id}", ['title' => 'Hacked'])
            ->assertForbidden();

        $this->assertSame('Buy milk', $task->fresh()->title);
    }

    public function test_renaming_to_a_title_at_the_limit_is_accepted(): void
    {
        $user = User::factory()->create();
        $task = Task::factory()->for($user)->create(['title' => 'Buy milk']);
        $title = str_repeat('a', Task::MAX_TITLE_LENGTH);

        $this->actingAs($user)->putJson("/api/tasks/{$task->id}", ['title' => $title])
            ->assertOk()
            ->assertJsonPath('title', $title);

        $this->assertSame($title, $task->fresh()->title);
    }

    public function test_renaming_without_a_title_is_refused(): void
    {
        $user = User::factory()->create();
        $task = Task::factory()->for($user)->create(['title' => 'Buy milk']);

        $this->actingAs($user)->putJson("/api/tasks/{$task->id}", [])
            ->assertStatus(422)
            ->assertJsonValidationErrors('title');

        $this->assertSame('Buy milk', $task->fresh()->title);
    }

    public function test_a_guest_cannot_rename_a_task(): void
    {
        $task = Task::factory()->create(['title' => 'Buy milk']);

        $this->putJson("/api/tasks/{$task->id}", ['title' => 'Hacked'])
            ->assertUnauthorized();

        $this->assertSame('Buy milk', $task->fresh()->title);
    }

    public function test_renaming_a_missing_task_answers_not_found(): void
    {
        $this->actingAs(User::factory()->create())->putJson('/api/tasks/999999', ['title' => 'Anything'])
            ->assertNotFound();
    }

    public function test_another_users_task_is_refused_before_validation(): void
    {
        $task = Task::factory()->create(['title' => 'Buy milk']);

        $this->actingAs(User::factory()->create())->putJson("/api/tasks/{$task->id}", ['title' => ''])
            ->assertForbidden();

        $this->assertSame('Buy milk', $task->fresh()->title);
    }

    public function test_a_user_can_delete_their_task(): void
    {
        $user = User::factory()->create();
        $task = Task::factory()->for($user)->create();
        $other = Task::factory()->for($user)->create(['title' => 'Keep me']);

        $this->actingAs($user)->deleteJson("/api/tasks/{$task->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('tasks', ['id' => $task->id]);
        $this->actingAs($user)->getJson('/api/tasks')
            ->assertJsonCount(1)
            ->assertJsonPath('0.id', $other->id);
    }

    public function test_a_user_cannot_delete_another_users_task(): void
    {
        $task = Task::factory()->create();

        $this->actingAs(User::factory()->create())->deleteJson("/api/tasks/{$task->id}")
            ->assertForbidden();

        $this->assertDatabaseHas('tasks', ['id' => $task->id]);
    }

    public function test_a_guest_cannot_delete_a_task(): void
    {
        $task = Task::factory()->create();

        $this->deleteJson("/api/tasks/{$task->id}")
            ->assertUnauthorized();

        $this->assertDatabaseHas('tasks', ['id' => $task->id]);
    }

    public function test_deleting_a_missing_task_answers_not_found(): void
    {
        $user = User::factory()->create();
        $task = Task::factory()->for($user)->create();

        $this->actingAs($user)->deleteJson("/api/tasks/{$task->id}")->assertNoContent();
        $this->actingAs($user)->deleteJson("/api/tasks/{$task->id}")->assertNotFound();
    }
}
