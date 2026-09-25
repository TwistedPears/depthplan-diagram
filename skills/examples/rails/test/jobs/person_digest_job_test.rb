require 'test_helper'

class PersonDigestJobTest < ActiveJob::TestCase
  test 'uses the default queue' do
    assert_enqueued_with(job: PersonDigestJob, args: [42], queue: 'default') do
      PersonDigestJob.perform_later(42)
    end
  end
end
