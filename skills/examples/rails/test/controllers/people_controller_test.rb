require 'test_helper'

class PeopleControllerTest < ActionDispatch::IntegrationTest
  test 'index renders people' do
    get people_url
    assert_response :success
  end
end
